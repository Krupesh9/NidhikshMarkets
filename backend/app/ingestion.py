import asyncio
from datetime import datetime,timedelta,timezone
from sqlalchemy import select,delete
from sqlalchemy.dialects.sqlite import insert
from .db import transaction
from .config import settings
from .models import Instrument,PriceBar,ProviderStatus,IngestionRun,InstrumentLogo,InstrumentDirectory,EarningsEvent,IPOCalendarCache,NewsEvent,Filing,Fundamental,EconomicSeries,InsiderTransaction,SignalEvent,StrategyDefinition,now
from .providers import Alpaca,SEC,FRED,GDELT,ProviderError,ProviderNotFound
from .signals import evaluate,VERSION,parameter_hash
from .schemas import StrategyConfig

refresh_lock=asyncio.Lock()

def upsert(db,model,values,keys,update=True):
    statement=insert(model).values(**values)
    statement=statement.on_conflict_do_update(index_elements=keys,set_={k:v for k,v in values.items() if k not in keys}) if update else statement.on_conflict_do_nothing(index_elements=keys)
    db.execute(statement)

def status(code:str,state:str,message:str='',records=0,run_id=None):
    with transaction() as db:
        p=db.get(ProviderStatus,code)
        if p is None:
            p=ProviderStatus(code=code,status=state,message=message)
            db.add(p)
        p.status=state; p.message=message; p.last_attempt=now()
        if state=='ready':
            p.last_success=now()
        if run_id:
            run=db.get(IngestionRun,run_id)
            run.completed_at=now(); run.status=state; run.records=records; run.message=message

def start_run(code):
    with transaction() as db:
        run=IngestionRun(provider=code,started_at=now(),status='running')
        db.add(run); db.flush(); return run.id

def serialize_bar(b):
    return {k:getattr(b,k) for k in ['timestamp','open','high','low','close','volume','event_time','available_at','provenance']}

def persist_signals(db,instrument_id,bars):
    config=StrategyConfig()
    for e in evaluate(bars,config):
        upsert(db,SignalEvent,dict(instrument_id=instrument_id,strategy_id=e['strategy'],version=VERSION,bar_time=e['time'],evaluated_at=now(),provider='alpaca',feed=settings().alpaca_feed,adjustment='split',parameter_hash=parameter_hash(config),payload=e),['instrument_id','strategy_id','version','bar_time','provider','feed','adjustment','parameter_hash'],update=False)

async def refresh(providers:list[str] | None=None, symbols:list[str] | None=None):
    if refresh_lock.locked():
        return {'status':'already_running'}
    async with refresh_lock:
        cfg=settings()
        with transaction() as db:
            instruments=list(db.scalars(select(Instrument).where(Instrument.active==True)))
            if symbols:
                instruments=[i for i in instruments if i.symbol in symbols]
        selected=providers or ['alpaca','alpaca_news','sec','fred','gdelt']
        results={}
        for code in selected:
            with transaction() as db:
                previous=db.get(ProviderStatus,code)
                recent=bool(previous and previous.status=='ready' and previous.last_success and (datetime.now(timezone.utc)-datetime.fromisoformat(previous.last_success.replace('Z','+00:00'))).total_seconds()<1800)
                enough=True
                if code=='alpaca':
                    minimum=(datetime.now(timezone.utc)-timedelta(days=366*cfg.history_years+350)).isoformat().replace('+00:00','Z')
                    for item in instruments:
                        earliest=db.scalar(select(PriceBar.timestamp).where(PriceBar.instrument_id==item.id,PriceBar.provider=='alpaca',PriceBar.feed==cfg.alpaca_feed,PriceBar.adjustment=='split').order_by(PriceBar.timestamp).limit(1))
                        if not earliest or earliest>minimum:enough=False
            if recent and (enough or (code=='alpaca' and previous and f'history_years={cfg.history_years}' in previous.message)) and not symbols:
                results[code]={'status':'cached','message':'Fresh result reused; no outbound calls (30-minute minimum refresh interval)'}
                continue
            run=start_run(code); count=0;missing_components=[]
            try:
                if code=='alpaca':
                    adapter=Alpaca(cfg)
                    missing=[]
                    # Keep raw and split-adjusted OHLCV separate. Never mix adjustment modes.
                    for adjustment in ['raw','split']:
                        batch=await adapter.bars([i.symbol for i in instruments],adjustment)
                        with transaction() as db:
                            for instrument in instruments:
                                bars=batch.get(instrument.symbol,[])
                                if not bars:
                                    missing.append(instrument.symbol)
                                for dto in bars:
                                    b=dto.model_dump(); prov=b.pop('provenance')
                                    upsert(db,PriceBar,dict(instrument_id=instrument.id,timeframe='1d',provider='alpaca',feed=cfg.alpaca_feed,adjustment=adjustment,observed_at=prov['observed_at'],fetched_at=prov['fetched_at'],provenance=prov,**b),['instrument_id','timeframe','timestamp','provider','feed','adjustment'])
                                    count+=1
                                if adjustment=='split' and bars:
                                    stored=list(db.scalars(select(PriceBar).where(PriceBar.instrument_id==instrument.id,PriceBar.provider=='alpaca',PriceBar.feed==cfg.alpaca_feed,PriceBar.adjustment=='split').order_by(PriceBar.timestamp)))
                                    persist_signals(db,instrument.id,[serialize_bar(b) for b in stored])
                    if missing:
                        raise ProviderError('Partial history; no data returned for: '+', '.join(sorted(set(missing))))
                elif code=='corporate_actions':
                    from .corporate_actions import persist_actions
                    rows=await Alpaca(cfg).corporate_actions([item.symbol for item in instruments])
                    with transaction() as db:count=persist_actions(db,rows)
                elif code=='company_profile':
                    from .profiles import fetch_profile
                    for item in instruments:
                        with transaction() as db:
                            existing=db.scalar(select(Fundamental).where(Fundamental.instrument_id==item.id,Fundamental.provider=='alpha_vantage').order_by(Fundamental.fetched_at.desc()))
                        if existing and (datetime.now(timezone.utc)-datetime.fromisoformat(existing.fetched_at.replace('Z','+00:00'))).total_seconds()<86400:continue
                        payload=await fetch_profile(item.symbol)
                        with transaction() as db:db.add(Fundamental(instrument_id=item.id,provider='alpha_vantage',available_at=now(),fetched_at=now(),payload=payload))
                        count+=1
                elif code=='ipos':
                    from .ipos import fetch_calendar
                    with transaction() as db:existing=db.get(IPOCalendarCache,'alpha_vantage')
                    if existing and (datetime.now(timezone.utc)-datetime.fromisoformat(existing.fetched_at.replace('Z','+00:00'))).total_seconds()<86400:
                        count=len(existing.items)
                    else:
                        rows=await fetch_calendar()
                        with transaction() as db:db.merge(IPOCalendarCache(provider='alpha_vantage',fetched_at=now(),source_url='https://www.alphavantage.co/documentation/#ipo-calendar',items=rows))
                        count=len(rows)
                elif code=='earnings':
                    from .earnings import fetch_calendar
                    rows=await fetch_calendar()
                    with transaction() as db:
                        for row in rows:
                            upsert(db,EarningsEvent,dict(row,fetched_at=now()),['symbol','report_date','provider'])
                            count+=1
                elif code=='directory':
                    rows=await Alpaca(cfg).directory()
                    with transaction() as db:
                        for item in rows:
                            if item.get('exchange') not in ['NYSE','NASDAQ','ARCA','BATS','NYSEARCA','AMEX']:continue
                            existing=db.scalar(select(InstrumentDirectory).where(InstrumentDirectory.symbol==item['symbol']))
                            prior=existing.payload if existing else {}
                            upsert(db,InstrumentDirectory,{'symbol':item['symbol'],'name':item['name'],'exchange':item['exchange'],'provider_id':item['id'],'fetched_at':now(),'payload':dict(prior,status=item.get('status'),tradable=item.get('tradable'),source='Alpaca asset directory',aliases=['SpaceX','Space X','Space Exploration'] if item['symbol']=='SPCX' else [])},['symbol'])
                            count+=1
                elif code=='logos':
                    from .providers import HTTP
                    issuers={'direxion':'direxion.com','ishares':'ishares.com','invesco':'invesco.com','spdr':'ssga.com','vanguard':'vanguard.com','vaneck':'vaneck.com','proshares':'proshares.com'}
                    for item in instruments:
                        with transaction() as db:existing=db.get(InstrumentLogo,item.symbol)
                        if existing and (existing.content or (datetime.now(timezone.utc)-datetime.fromisoformat(existing.fetched_at.replace('Z','+00:00'))).total_seconds()<3600):continue
                        source=f'https://logoapi.sh/ticker/{item.symbol}.png'
                        try:
                            content,mime=await HTTP().get(source,params={'size':128,'fallback':'none'},binary=True)
                        except ProviderError as e:
                            issuer=next((domain for name,domain in issuers.items() if name in item.name.lower()),None)
                            if issuer and '404' in str(e):
                                source=f'https://logoapi.sh/icon/{issuer}.png'
                                try:content,mime=await HTTP().get(source,params={'size':128,'fallback':'none'},binary=True)
                                except ProviderError:
                                    with transaction() as db:db.merge(InstrumentLogo(symbol=item.symbol,content=None,content_type='',source=source,fetched_at=now(),status='unavailable'))
                                    continue
                            elif '404' in str(e):
                                with transaction() as db:db.merge(InstrumentLogo(symbol=item.symbol,content=None,content_type='',source=source,fetched_at=now(),status='unavailable'))
                                continue
                            else:raise
                        with transaction() as db:db.merge(InstrumentLogo(symbol=item.symbol,content=content,content_type=mime,source=source,fetched_at=now(),status='issuer_logo' if '/icon/' in source else 'ready'))
                        count+=1
                elif code=='alpaca_news':
                    rows=await Alpaca(cfg).news([i.symbol for i in instruments])
                    with transaction() as db:
                        for row in rows:
                            for item in instruments:
                                if item.symbol in row['payload']['symbols']:
                                    upsert(db,NewsEvent,dict(instrument_id=item.id,**row),['instrument_id','url','provider'],update=False)
                                    count+=1
                elif code=='sec_directory':
                    from .sec_mapping import map_missing_ciks
                    count=await map_missing_ciks(instruments,cfg)
                    with transaction() as db:mapping_status=db.get(ProviderStatus,'sec_directory')
                    if mapping_status and mapping_status.status!='ready':raise ProviderError(mapping_status.message)
                elif code=='sec':
                    from .sec_mapping import map_missing_ciks
                    await map_missing_ciks(instruments,cfg)
                    adapter=SEC(cfg)
                    for instrument in [i for i in instruments if i.cik]:
                        # Submissions and XBRL have independent coverage (notably for ETFs).
                        # Only an exact HTTP 404 is an issuer-level absence. Auth, rate,
                        # budget and transport failures remain batch-level failures.
                        try:
                            filings=await adapter.filings(instrument.cik)
                        except ProviderNotFound:
                            missing_components.append(f'{instrument.symbol}:filings')
                            status(f'sec:{instrument.symbol}:filings','missing',f'SEC submissions missing for {instrument.symbol}, CIK {instrument.cik}; HTTP 404. Cached filings retained. Source https://data.sec.gov/submissions/CIK{int(instrument.cik):010d}.json')
                        else:
                            with transaction() as db:
                                for filing in filings:
                                    upsert(db,Filing,dict(instrument_id=instrument.id,**filing),['instrument_id','accession'])
                                    if filing['form'].startswith('4'):
                                        fid=db.scalar(select(Filing.id).where(Filing.instrument_id==instrument.id,Filing.accession==filing['accession']))
                                        upsert(db,InsiderTransaction,{'filing_id':fid,'payload':{'status':'disclosure_link_only','note':'Transaction XML not parsed; view original Form 4. No trade-date or insider amounts inferred.','url':filing['url'],'available_at':filing['available_at']}},['filing_id'])
                                count+=len(filings)
                            status(f'sec:{instrument.symbol}:filings','ready',f'{len(filings)} submissions records processed; CIK {instrument.cik}')
                        try:
                            facts=await adapter.fundamentals(instrument.cik)
                        except ProviderNotFound:
                            missing_components.append(f'{instrument.symbol}:fundamentals')
                            with transaction() as db:cached=db.scalar(select(Fundamental.id).where(Fundamental.instrument_id==instrument.id,Fundamental.provider=='sec').limit(1))
                            status(f'sec:{instrument.symbol}:fundamentals','missing',f'SEC companyfacts missing for {instrument.symbol}, CIK {instrument.cik}; HTTP 404. '+('Previous cached facts retained.' if cached else 'No reported facts cached.')+f' Source https://data.sec.gov/api/xbrl/companyfacts/CIK{int(instrument.cik):010d}.json')
                        else:
                            with transaction() as db:
                                upsert(db,Fundamental,dict(instrument_id=instrument.id,available_at=facts['fetched_at'],fetched_at=facts['fetched_at'],provider='sec',payload=facts),['instrument_id','available_at','provider'])
                                count+=1
                            status(f'sec:{instrument.symbol}:fundamentals','ready',f'Companyfacts processed; CIK {instrument.cik}; source reporting periods retained')
                elif code=='fred':
                    if not cfg.fred_storage_permission_confirmed:
                        raise ProviderError('Restricted: current FRED API terms prohibit local caching. Written storage permission required; key verification succeeded earlier, but no observations are retained.')
                    adapter=FRED(cfg)
                    for series in ['DGS10','FEDFUNDS','CPIAUCSL','DCOILWTICO']:
                        rows=await adapter.observations(series)
                        with transaction() as db:
                            for row in rows:
                                # Preserve earliest first-observed timestamp for the same vintage.
                                upsert(db,EconomicSeries,row,['series_id','event_time','revision'],update=False)
                            count+=len(rows)
                elif code=='gdelt':
                    adapter=GDELT()
                    mapping={'NVDA':['NVIDIA'],'AAPL':['Apple Inc','Apple'],'AMD':['Advanced Micro Devices','AMD'],'MSFT':['Microsoft'],'TSLA':['Tesla']}
                    rows=await adapter.news_batch([names[0] for names in mapping.values()])
                    with transaction() as db:
                        for instrument in instruments:
                            names=mapping.get(instrument.symbol,[])
                            for row in rows:
                                if not any(name.lower() in row['title'].lower() for name in names):continue
                                payload=dict(row['payload'],company_mapping='headline keyword match; may be noisy',matched_symbol=instrument.symbol)
                                upsert(db,NewsEvent,dict(row,instrument_id=instrument.id,payload=payload),['instrument_id','url','provider'],update=False)
                                count+=1
                status(code,'ready',f'{count} records processed'+(f'; history_years={cfg.history_years}' if code=='alpaca' else '')+(f'; unavailable source components (HTTP404): {", ".join(missing_components)}' if missing_components else ''),count,run)
                results[code]={'status':'ready','records':count,**({'missing_components':missing_components} if missing_components else {})}
            except ProviderError as e:
                status(code,'unavailable',str(e),count,run)
                results[code]={'status':'unavailable','message':str(e),'records':count}
            except Exception:
                # Do not serialize HTTP exceptions or provider payloads containing credentials.
                status(code,'error','Refresh failed validation; cached records retained. See test/diagnostic workflow.',count,run)
                results[code]={'status':'error','records':count}
        with transaction() as db:
            cutoff=(datetime.now(timezone.utc)-timedelta(days=cfg.news_retention_days)).isoformat().replace('+00:00','Z')
            db.execute(delete(NewsEvent).where(NewsEvent.fetched_at<cutoff))
            db.execute(delete(Fundamental).where(Fundamental.fetched_at<cutoff))
            db.execute(delete(IngestionRun).where(IngestionRun.started_at<cutoff))
        return results

async def collector(stop:asyncio.Event):
    # Same backend process is the sole writer. No separate SQLite-writing replica.
    while not stop.is_set():
        with transaction() as db:
            statuses={p.code:p for p in db.scalars(select(ProviderStatus))}
        due=[]
        for code,seconds in [('alpaca',max(1800,settings().refresh_interval_seconds)),('alpaca_news',1800),('sec',21600),('fred',21600),('gdelt',1800)]:
            p=statuses.get(code)
            if not p or not p.last_attempt or (datetime.now(timezone.utc)-datetime.fromisoformat(p.last_attempt.replace('Z','+00:00'))).total_seconds()>seconds:
                due.append(code)
        if due:
            await refresh(due)
        try:
            await asyncio.wait_for(stop.wait(),timeout=60)
        except asyncio.TimeoutError:
            pass
