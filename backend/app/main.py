import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime,timedelta,timezone
from typing import Literal,Annotated
from fastapi import FastAPI,Depends,HTTPException,Request,Response,Query
from pydantic import BaseModel,Field
from sqlalchemy import select,delete,func
from .config import settings
from .db import transaction
from .models import *
from .auth import current_user,admin,login,COOKIE,digest,data_access
from .universe import UNIVERSE,CORE
from .schemas import IndicatorConfig,StrategyConfig
from .indicators import calculate
from .signals import evaluate,VERSION,parameter_hash
from .demo import demo_bars,DEMO_TIME
from .providers import session_status
from .ingestion import refresh,collector,refresh_lock,serialize_bar,upsert

Mode=Literal['market','demo']
Range=Literal['1m','3m','6m','1y','3y','5y']

@asynccontextmanager
async def lifespan(app):
    stop=asyncio.Event()
    job=asyncio.create_task(collector(stop)) if settings().collectors_enabled else None
    app.state.refresh_task=None
    yield
    stop.set()
    for task in [job,app.state.refresh_task]:
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

app=FastAPI(title='Nidhiksh Markets — private research',version='0.1.0',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)

@app.middleware('http')
async def protect_headers(request,call_next):
    response=await call_next(request)
    response.headers['Cache-Control']='no-store'
    response.headers['X-Content-Type-Options']='nosniff'
    return response

class LoginBody(BaseModel):
    username:str=Field(min_length=1,max_length=80)
    password:str=Field(min_length=1,max_length=256)

@app.post('/auth/login')
def sign_in(body:LoginBody,request:Request,response:Response):
    token,csrf,user=login(request,body.username,body.password)
    response.set_cookie(COOKIE,token,max_age=settings().session_hours*3600,httponly=True,secure=settings().cookie_secure,samesite='strict',path='/')
    return {'username':user.username,'role':user.role,'csrf':csrf,'demo_enabled':settings().demo_enabled}

@app.get('/auth/session')
def session(request:Request,user:User=Depends(current_user)):
    return {'username':user.username,'role':user.role,'csrf':request.state.csrf,'demo_enabled':settings().demo_enabled,'partner_data_display_approved':settings().partner_data_display_approved}

@app.post('/auth/logout')
def sign_out(request:Request,response:Response,user:User=Depends(current_user)):
    with transaction() as db:
        db.execute(delete(LoginSession).where(LoginSession.token_hash==digest(request.cookies.get(COOKIE,''))))
        db.add(AuditEvent(user_id=user.id,action='logout'))
    response.delete_cookie(COOKIE,path='/')
    return {'ok':True}

@app.get('/health')
def health(user:User=Depends(current_user)):
    with transaction() as db:
        db.execute(select(1)).scalar()
    return {'status':'ok','database':'sqlite','writer':'single backend process','collectors_enabled':settings().collectors_enabled,'refresh_running':refresh_lock.locked(),'as_of':now()}

@app.get('/providers/status')
def provider_status(user:User=Depends(current_user)):
    cfg=settings()
    from .budgets import usage
    budgets=usage()
    definitions=[('company_profile','Company fundamentals & analyst ratings',bool(cfg.alpha_vantage_api_key and cfg.alpha_vantage_overview_enabled),'Premium overview access is required; disabled on the free connection'),('alpaca','Alpaca Market Data',bool(cfg.alpaca_api_key and cfg.alpaca_secret_key),f'{cfg.alpaca_feed.upper()} daily history; '+('consolidated delayed access' if cfg.alpaca_feed=='sip' else 'partial venue, not consolidated volume')),
        ('alpaca_news','Alpaca News',bool(cfg.alpaca_api_key and cfg.alpaca_secret_key),'Original publisher headlines and timestamps; fetched in symbol batches'),
        ('sec','SEC EDGAR',bool('@' in cfg.sec_user_agent),'Public filings and reported facts; identifying User-Agent required'),
        ('fred','FRED',bool(cfg.fred_api_key),'Storage restricted by current FRED API terms; written permission required'),('gdelt','GDELT',True,'Public headline discovery; original links only'),('directory','Symbol directory',bool(cfg.alpaca_api_key),'Locally cached supported US stocks and ETFs'),('logos','Company logos',True,'LogoAPI.sh; company/issuer marks cached locally'),('heatmap','Market heatmaps',bool(cfg.alpaca_api_key),'IVV / QQQ / IWM holdings proxies with delayed daily prices'),('earnings','Earnings calendar',bool(cfg.alpha_vantage_api_key),'Alpha Vantage schedule; dates and estimates may change'),('ipos','Upcoming IPOs',bool(cfg.alpha_vantage_api_key),'Expected three-month IPO schedule with a 24-hour cache'),('corporate_actions','Corporate actions',bool(cfg.alpaca_api_key and cfg.alpaca_secret_key),'Documented split, distribution and symbol-event observations; availability depends on the data plan'),('sec_directory','Company filing directory',bool('@' in cfg.sec_user_agent),'One bulk current SEC ticker association, cached for 24 hours'),('yahoo','Yahoo Finance',False,'Disabled; no unofficial requests')]
    with transaction() as db:
        out=[]
        for code,name,configured,note in definitions:
            stored=db.get(ProviderStatus,code)
            state=stored.status if stored else 'not_fetched' if configured else 'not_configured'
            if code=='company_profile' and not cfg.alpha_vantage_overview_enabled:state='access_required'
            stale=bool(stored and stored.last_success and (datetime.now(timezone.utc)-datetime.fromisoformat(stored.last_success.replace('Z','+00:00'))).total_seconds()>86400)
            budget=budgets.get('alpaca' if code in ['alpaca_news','directory','heatmap','corporate_actions'] else 'sec' if code=='sec_directory' else 'alpha_vantage' if code in ['earnings','company_profile','ipos'] else code)
            out.append({'code':code,'name':name,'configured':configured,'status':'paused' if budget and budget['paused'] and state!='access_required' else state,'stale':stale,'last_success':stored.last_success if stored else None,'last_attempt':stored.last_attempt if stored else None,'message':stored.message if stored else note,'note':note,'budget':budget})
        return {'providers':out,'refresh_running':refresh_lock.locked(),'display_rights':'personal research only; partner rights unverified' if not cfg.partner_data_display_approved else 'owner attested partner display rights','as_of':now()}

def instrument(db,symbol):
    row=db.scalar(select(Instrument).where(Instrument.symbol==symbol.upper()))
    if not row:
        raise HTTPException(404,'Unknown instrument')
    return row

@app.get('/instruments/search')
def search(q:str=Query('',max_length=80),user:User=Depends(current_user)):
    with transaction() as db:
        tracked={i.symbol:i for i in db.scalars(select(Instrument).order_by(Instrument.id))}
        source=list(db.scalars(select(InstrumentDirectory))) if q else list(tracked.values())
        if q and not source:source=list(tracked.values())
        query=''.join(c for c in q.lower() if c.isalnum())
        matches=[]
        for item in source:
            aliases=item.payload.get('aliases',[]) if isinstance(item,InstrumentDirectory) else []
            haystack=' '.join([item.symbol,item.name,*aliases])
            normalized=''.join(c for c in haystack.lower() if c.isalnum())
            if query and query not in normalized:continue
            i=tracked.get(item.symbol)
            quotes=list(db.scalars(select(PriceBar).where(PriceBar.instrument_id==i.id,PriceBar.provider=='alpaca',PriceBar.feed==settings().alpaca_feed,PriceBar.adjustment=='split').order_by(PriceBar.timestamp.desc()).limit(2))) if i else []
            matches.append({'symbol':item.symbol,'name':item.name,'asset_type':i.asset_type if i else 'US equity / ETF','currency':'USD','timezone':'America/New_York','note':i.note if i else 'Not cached; add to fetch available history','cached':bool(i),'price':quotes[0].close if quotes else None,'change_percent':(quotes[0].close/quotes[1].close-1)*100 if len(quotes)>1 else None,'aliases':aliases})
        matches.sort(key=lambda i:(i['symbol'].lower()!=q.lower(),not i['cached'],i['symbol']))
        return matches[:60] if q else matches

def load_bars(db,symbol,mode):
    i=instrument(db,symbol)
    if mode=='demo':
        return i,demo_bars(i.symbol)
    rows=db.scalars(select(PriceBar).where(PriceBar.instrument_id==i.id,PriceBar.provider=='alpaca',PriceBar.feed==settings().alpaca_feed,PriceBar.adjustment=='split',PriceBar.timeframe=='1d').order_by(PriceBar.timestamp))
    return i,[serialize_bar(b) for b in rows]

def freshness(db,bars,mode):
    if mode=='demo':
        return {'status':'demo','as_of':DEMO_TIME,'source':'SYNTHETIC — NOT MARKET DATA','stale':False,'message':'Fabricated prices for demonstration. Fixed illustrative dates.'}
    p=db.get(ProviderStatus,'alpaca')
    if not bars:
        return {'status':'unavailable','as_of':None,'source':'Alpaca','stale':False,'message':'No cached market data. Configure credentials and refresh.'}
    last=bars[-1]; stamp=datetime.fromisoformat(last['event_time'].replace('Z','+00:00'))
    stale=(datetime.now(timezone.utc)-stamp).total_seconds()>4*86400 or bool(p and p.status!='ready')
    return {'status':'stale' if stale else 'cached','as_of':last['event_time'],'fetched_at':last['provenance']['fetched_at'],'source':'Alpaca '+settings().alpaca_feed.upper(),'stale':stale,'message':p.message if p and p.status!='ready' else 'Last completed daily close; not a live quote','provenance':last['provenance']}

def config_for(db,user,key,cls):
    row=db.scalar(select(AppSetting).where(AppSetting.user_id==user.id,AppSetting.key==key))
    return cls.model_validate(row.value) if row else cls()

@app.get('/instruments/{symbol}/bars')
def bars(symbol:str,mode:Mode='market',range:Range='1y',timeframe:Literal['1d']='1d',user:User=Depends(current_user)):
    data_access(user,mode)
    with transaction() as db:
        i,all_bars=load_bars(db,symbol,mode)
        cfg=config_for(db,user,'indicators',IndicatorConfig)
        values=calculate(all_bars,cfg)
        days={'1m':31,'3m':93,'6m':186,'1y':366,'3y':1096,'5y':1827}[range]
        anchor=datetime.fromisoformat(all_bars[-1]['timestamp'].replace('Z','+00:00')) if mode=='demo' and all_bars else datetime.now(timezone.utc)
        cutoff=(anchor-timedelta(days=days)).isoformat().replace('+00:00','Z')
        selected=[n for n,b in enumerate(all_bars) if b['timestamp']>=cutoff]
        start=selected[0] if selected else len(all_bars)
        first=datetime.fromisoformat(all_bars[0]['timestamp'].replace('Z','+00:00')) if all_bars else anchor
        supported=[r for r,days_ in [('1m',31),('3m',93),('6m',186),('1y',366),('3y',1096),('5y',1827)] if all_bars and (anchor-first).days>=days_-7]
        return {'symbol':i.symbol,'bars':all_bars[start:],'indicators':{k:v[start:] for k,v in values.items()},'config':cfg.model_dump(),'freshness':freshness(db,all_bars,mode),'total_bars':len(all_bars),'supported_ranges':supported,'coverage':{'first_bar':all_bars[0]['timestamp'] if all_bars else None,'last_bar':all_bars[-1]['timestamp'] if all_bars else None},'timeframe':'1d','note':'Current split-adjusted OHLCV; retrospective research. Historical adjustments and corrections can be revised by source. Intraday unavailable.'}

@app.get('/instruments/{symbol}/quote')
def quote_data(symbol:str,mode:Mode='market',user:User=Depends(current_user)):
    data_access(user,mode)
    with transaction() as db:
        i,rows=load_bars(db,symbol,mode)
        last=rows[-1] if rows else None
        change=(last['close']/rows[-2]['close']-1)*100 if len(rows)>1 else None
        return {'symbol':i.symbol,'name':i.name,'price':last['close'] if last else None,'change_percent':change,'volume':last['volume'] if last else None,'type':'daily_close','freshness':freshness(db,rows,mode),'note':i.note}

@app.get('/instruments/{symbol}/signals')
def signals(symbol:str,mode:Mode='market',user:User=Depends(current_user)):
    data_access(user,mode)
    with transaction() as db:
        i,rows=load_bars(db,symbol,mode)
        cfg=config_for(db,user,'strategies',StrategyConfig)
        events=evaluate(rows,cfg)
        if mode=='market':
            for e in events:
                upsert(db,SignalEvent,dict(instrument_id=i.id,strategy_id=e['strategy'],version=VERSION,bar_time=e['time'],evaluated_at=now(),provider='alpaca',feed=settings().alpaca_feed,adjustment='split',parameter_hash=e['parameter_hash'],payload=e),['instrument_id','strategy_id','version','bar_time','provider','feed','adjustment','parameter_hash'],update=False)
            stored=list(db.scalars(select(SignalEvent).where(SignalEvent.instrument_id==i.id,SignalEvent.feed==settings().alpaca_feed,SignalEvent.parameter_hash==parameter_hash(cfg),SignalEvent.version==VERSION).order_by(SignalEvent.bar_time)))
            events=[dict(s.payload,evaluated_at=s.evaluated_at) for s in stored]
        return {'events':events,'parameters':cfg.model_dump(),'version':VERSION,'status':'no_candidate' if not events else 'observed_historical','bars_evaluated':len(rows),'warmup':{'trend':cfg.trend_slow,'mean_reversion':max(15,cfg.mean_period),'breakout':max(21,cfg.breakout_high+1)},'note':'Unvalidated research. Episodes pair annotations only; no positions or fills. Persisted observations are immutable; provider corrections may differ from current bars.'}

@app.get('/markets/session')
def market_session(user:User=Depends(current_user)):
    return session_status()

@app.get('/markets/overview')
def overview(mode:Mode='market',user:User=Depends(current_user)):
    data_access(user,mode)
    items=[('SPY','US · S&P 500','ETF proxy'),('QQQ','US · Nasdaq 100','ETF proxy'),('DIA','US · Dow Jones','ETF proxy'),('EWJ','Asia · Japan','Japan equity ETF proxy; not Nikkei 225'),('INDA','Asia · India','India equity ETF proxy; not Nifty 50'),('FXI','Asia · China','China large-cap ETF proxy; not CSI 300 or Hang Seng'),('EWG','Europe · Germany','Germany equity ETF proxy; not DAX'),('GLD','Gold','Gold ETF proxy; not spot gold'),('USO','Oil','Oil futures fund proxy; not spot oil')]
    result=[]
    with transaction() as db:
        for symbol,label,note in items:
            _,rows=load_bars(db,symbol,mode)
            last=rows[-1] if rows else None
            result.append({'symbol':symbol,'label':label,'note':note,'proxy':True,'price':last['close'] if last else None,'change_percent':(last['close']/rows[-2]['close']-1)*100 if len(rows)>1 else None,'freshness':freshness(db,rows,mode)})
        for series,label in [('DGS10','US 10Y yield'),('FEDFUNDS','Fed funds'),('CPIAUCSL','US CPI'),('DCOILWTICO','WTI oil')]:
            macro=db.scalar(select(EconomicSeries).where(EconomicSeries.series_id==series).order_by(EconomicSeries.event_time.desc(),EconomicSeries.revision.desc())) if mode=='market' and settings().fred_storage_permission_confirmed else None
            result.append({'symbol':series,'label':label,'proxy':False,'price':macro.value if macro else None,'units':macro.payload['units'] if macro else None,'note':'FRED latest vintage; observation date differs from release time' if macro else 'Unavailable in this mode','freshness':{'status':'cached' if macro else 'unavailable','as_of':macro.event_time if macro else None,'fetched_at':macro.fetched_at if macro else None,'source':'FRED','stale':bool(macro and (datetime.now(timezone.utc)-datetime.fromisoformat(macro.fetched_at.replace('Z','+00:00'))).total_seconds()>86400)}})
        result.append({'symbol':'VIX','label':'VIX · official index','price':None,'proxy':False,'note':'No entitled official index provider configured','freshness':{'status':'unavailable','as_of':None}})
    return {'items':result,'session':session_status(),'mode':mode}

@app.get('/instruments/{symbol}/news')
def news(symbol:str,mode:Mode='market',user:User=Depends(current_user)):
    data_access(user,mode)
    with transaction() as db:
        i=instrument(db,symbol)
        rows=list(db.scalars(select(NewsEvent).where(NewsEvent.instrument_id==i.id).order_by(NewsEvent.available_at.desc()).limit(40))) if mode=='market' else []
        return {'items':[{'id':r.id,'title':r.title,'url':r.url,'publisher':r.publisher,'published_at':r.published_at,'discovered_at':r.available_at,'fetched_at':r.fetched_at,'provider':r.provider,'provenance':r.payload} for r in rows],'note':'Discovery times are not publication times. Original links; no article bodies.' if mode=='market' else 'Demo does not fabricate headlines. Switch to market mode for fetched news.'}

@app.get('/instruments/{symbol}/filings')
def filings(symbol:str,mode:Mode='market',user:User=Depends(current_user)):
    data_access(user,mode)
    with transaction() as db:
        i=instrument(db,symbol)
        rows=list(db.scalars(select(Filing).where(Filing.instrument_id==i.id).order_by(Filing.available_at.desc()).limit(40))) if mode=='market' else []
        return {'items':[{'id':r.id,'form':r.form,'url':r.url,'filing_date':r.event_time,'available_at':r.available_at,'fetched_at':r.fetched_at,'provenance':r.payload} for r in rows],'note':'Form 4: public disclosures only; transaction amounts not parsed. 13F: backward-looking and delayed.'}

@app.get('/instruments/{symbol}/fundamentals')
def fundamentals(symbol:str,mode:Mode='market',user:User=Depends(current_user)):
    data_access(user,mode)
    with transaction() as db:
        i=instrument(db,symbol)
        row=db.scalar(select(Fundamental).where(Fundamental.instrument_id==i.id,Fundamental.provider=='sec').order_by(Fundamental.fetched_at.desc())) if mode=='market' else None
        _,price_rows=load_bars(db,symbol,mode)
        price=price_rows[-1]['close'] if price_rows else None
        metrics={'market_cap_estimate':None,'pe_ttm':None,'forward_pe':None,'eps_ttm':None,'forward_pe_reason':'Analyst consensus is not supplied by SEC or the current market-data plan.'}
        if row:
            facts=row.payload.get('facts',{});shares=facts.get('EntityCommonStockSharesOutstanding')
            if shares and price:
                metrics['market_cap_estimate']={'value':price*shares['val'],'share_count':shares['val'],'share_date':shares.get('end'),'price_date':price_rows[-1]['event_time'],'note':'Estimate: last daily close × latest reported shares. Share classes and corporate actions may affect accuracy; not a provider-reported live market cap.'}
            eps=row.payload.get('ttm_eps')
            if eps:
                metrics['eps_ttm']=eps
                if eps['value']>0 and price:metrics['pe_ttm']={'value':price/eps['value'],'basis':eps,'price_date':price_rows[-1]['event_time']}
        profile=db.scalar(select(Fundamental).where(Fundamental.instrument_id==i.id,Fundamental.provider=='alpha_vantage').order_by(Fundamental.fetched_at.desc())) if mode=='market' else None
        if profile:
            values=profile.payload['values'];source={'provider':'Alpha Vantage','observed_at':profile.fetched_at,'source_as_of':None,'note':'Exact ratio update time not supplied by source'}
            if values.get('MarketCapitalization') is not None:metrics['market_cap_reported']=dict(source,value=values['MarketCapitalization'])
            if values.get('PERatio') is not None:metrics['pe_ttm']=dict(source,value=values['PERatio'])
            if values.get('ForwardPE') is not None:metrics['forward_pe']=dict(source,value=values['ForwardPE'])
            if values.get('EPS') is not None:metrics['eps_ttm']=dict(source,value=values['EPS'],period_end=profile.payload.get('latest_quarter'))
        from .profiles import access
        profile_access=access()
        last=db.get(ProviderStatus,'company_profile')
        profile_access['last_error']=last.message if last and last.status not in ['ready','running'] else None
        reported=db.get(ProviderStatus,f'sec:{i.symbol}:fundamentals')
        reported_status={'status':reported.status,'message':reported.message,'last_attempt':reported.last_attempt,'source_url':f'https://data.sec.gov/api/xbrl/companyfacts/CIK{int(i.cik):010d}.json' if i.cik else None} if reported else None
        return {'reported_status':reported_status,'profile_access':profile_access,'status':'cached' if row or profile else 'unavailable','data':row.payload if row else None,'metrics':metrics,'profile':dict(profile.payload,observed_at=profile.fetched_at) if profile else None,'as_of':row.available_at if row else None}

@app.get('/settings')
def read_settings(user:User=Depends(current_user)):
    with transaction() as db:
        result={r.key:r.value for r in db.scalars(select(AppSetting).where(AppSetting.user_id==user.id))}
        result.setdefault('indicators',IndicatorConfig().model_dump())
        result.setdefault('strategies',StrategyConfig().model_dump())
        result.setdefault('workspace',{'theme':'auto','dismissed_news':[],'range':'1y','chart':'candlestick','preset':'Technical','symbol':'NVDA','mode':'demo' if settings().demo_enabled else 'market','layout':'comfortable','show_signals':False,'chart_strategy':'trend'})
        return result

class Workspace(BaseModel):
    price_feed:Literal['delayed_sip','iex']='delayed_sip'
    chart_strategy:Literal['trend','mean_reversion','breakout']='trend'
    show_signals:bool=False
    theme:Literal['auto','light','dark']='auto'
    dismissed_news:list[str]=Field(default_factory=list,max_length=100)
    range:Range='1y'
    chart:Literal['candlestick','line','area']='candlestick'
    preset:str=Field(default='Technical',max_length=80)
    symbol:str=Field(default='NVDA',pattern=r'^[A-Z0-9.\-]{1,12}$')
    mode:Mode='demo'
    layout:Literal['comfortable','compact']='comfortable'

@app.put('/settings/{key}')
def save_settings(key:Literal['workspace','indicators','strategies'],body:dict,user:User=Depends(current_user)):
    try:
        value={'workspace':Workspace,'indicators':IndicatorConfig,'strategies':StrategyConfig}[key].model_validate(body).model_dump()
    except Exception:
        raise HTTPException(422,'Invalid settings values') from None
    with transaction() as db:
        upsert(db,AppSetting,{'user_id':user.id,'key':key,'value':value,'updated_at':now()},['user_id','key'])
    return value

class WatchlistBody(BaseModel):
    name:str=Field(min_length=1,max_length=80)
    symbols:list[str]=Field(max_length=100)

@app.get('/watchlists')
def watchlists(user:User=Depends(current_user)):
    with transaction() as db:
        return [{'id':r.id,'name':r.name,'symbols':r.symbols} for r in db.scalars(select(Watchlist).where(Watchlist.user_id==user.id))]

@app.post('/watchlists')
def save_watchlist(body:WatchlistBody,user:User=Depends(current_user)):
    with transaction() as db:
        valid=set(db.scalars(select(Instrument.symbol)))
        symbols=list(dict.fromkeys(s.upper() for s in body.symbols))
        if any(s not in valid for s in symbols):
            raise HTTPException(422,'Watchlist contains an unknown symbol')
        upsert(db,Watchlist,{'user_id':user.id,'name':body.name,'symbols':symbols},['user_id','name'])
    return {'ok':True}

@app.delete('/watchlists/{id}')
def delete_watchlist(id:int,user:User=Depends(current_user)):
    with transaction() as db:
        row=db.get(Watchlist,id)
        if not row or row.user_id!=user.id:
            raise HTTPException(404,'Watchlist not found')
        db.delete(row)
    return {'ok':True}

class PresetBody(BaseModel):
    name:str=Field(min_length=1,max_length=80)
    config:IndicatorConfig

@app.get('/presets')
def presets(user:User=Depends(current_user)):
    with transaction() as db:
        return [{'id':r.id,'name':r.name,'config':r.config} for r in db.scalars(select(IndicatorPreset).where(IndicatorPreset.user_id==user.id))]

@app.post('/presets')
def save_preset(body:PresetBody,user:User=Depends(current_user)):
    with transaction() as db:
        upsert(db,IndicatorPreset,{'user_id':user.id,'name':body.name,'config':body.config.model_dump()},['user_id','name'])
    return {'ok':True}

@app.delete('/presets/{id}')
def delete_preset(id:int,user:User=Depends(current_user)):
    with transaction() as db:
        row=db.get(IndicatorPreset,id)
        if not row or row.user_id!=user.id:
            raise HTTPException(404,'Preset not found')
        db.delete(row)
    return {'ok':True}

class RefreshBody(BaseModel):
    providers:list[Literal['alpaca','alpaca_news','sec','fred','gdelt','corporate_actions','sec_directory','logos','directory']]=Field(default_factory=lambda:['alpaca','alpaca_news','sec','fred','gdelt'],min_length=1,max_length=9)

@app.post('/admin/refresh',status_code=202)
async def admin_refresh(body:RefreshBody,request:Request,user:User=Depends(admin)):
    if refresh_lock.locked() or (request.app.state.refresh_task and not request.app.state.refresh_task.done()):
        return {'status':'already_running'}
    with transaction() as db:
        db.add(AuditEvent(user_id=user.id,action='refresh_requested',detail=','.join(body.providers)))
    request.app.state.refresh_task=asyncio.create_task(refresh(list(dict.fromkeys(body.providers))))
    return {'status':'queued'}

@app.get('/admin/ingestion-runs')
def runs(user:User=Depends(admin)):
    with transaction() as db:
        return [{k:getattr(r,k) for k in ['id','provider','started_at','completed_at','status','records','message']} for r in db.scalars(select(IngestionRun).order_by(IngestionRun.id.desc()).limit(30))]

@app.get('/admin/users')
def users(user:User=Depends(admin)):
    with transaction() as db:
        return [{'id':u.id,'username':u.username,'role':u.role,'active':u.active} for u in db.scalars(select(User))]

@app.delete('/admin/users/{id}/sessions')
def revoke_sessions(id:int,user:User=Depends(admin)):
    with transaction() as db:
        if id==user.id:
            raise HTTPException(400,'Use logout to end your own session')
        target=db.get(User,id)
        if not target:
            raise HTTPException(404,'User not found')
        target.active=False
        db.execute(delete(LoginSession).where(LoginSession.user_id==id))
        db.add(AuditEvent(user_id=user.id,action='user_revoked',detail=str(id)))
    return {'ok':True}

class PreviewBody(BaseModel):
    config:IndicatorConfig
    mode:Mode='market'

@app.post('/instruments/{symbol}/indicators/preview')
def preview_indicators(symbol:str,body:PreviewBody,user:User=Depends(current_user)):
    data_access(user,body.mode)
    with transaction() as db:
        _,rows=load_bars(db,symbol,body.mode)
    values=calculate(rows,body.config)
    return {'values':{k:next((v for v in reversed(a) if v is not None),None) for k,a in values.items()},'bars':len(rows),'note':'Preview only; changes have not been saved.'}

class AddInstrumentBody(BaseModel):
    symbol:str=Field(pattern=r'^[A-Z][A-Z0-9.\-]{0,11}$')

@app.post('/instruments',status_code=202)
async def add_instrument(body:AddInstrumentBody,request:Request,user:User=Depends(admin)):
    from .providers import Alpaca,HTTP,ProviderError
    with transaction() as db:
        found=db.scalar(select(Instrument).where(Instrument.symbol==body.symbol))
        if found:return {'status':'cached','symbol':found.symbol,'message':'Existing instrument reused; no external request'}
    if refresh_lock.locked():raise HTTPException(409,'Wait for the current refresh before fetching a new symbol')
    adapter=Alpaca(settings())
    try:
        # Read-only official asset metadata; this application has no order endpoint.
        asset=await HTTP().get(adapter.asset_base+'/v2/assets/'+body.symbol,headers=adapter.headers)
    except ProviderError as e:
        raise HTTPException(422,str(e)) from None
    if asset.get('class')!='us_equity' or asset.get('status')!='active':
        raise HTTPException(422,'Only active US equity/ETF instruments are supported')
    with transaction() as db:
        row=Instrument(symbol=asset['symbol'],name=asset['name'],asset_type='equity_or_etf',exchange='XNAS' if asset.get('exchange')=='NASDAQ' else 'XNYS',note='Metadata from Alpaca; asset subtype not independently classified. SEC ticker association resolved during filings refresh; unsupported issuers remain unavailable.',symbol_history=[{'provider_id':asset.get('id'),'current_symbol':asset['symbol']}])
        db.add(row);db.add(AuditEvent(user_id=user.id,action='instrument_added',detail=body.symbol))
    request.app.state.refresh_task=asyncio.create_task(refresh(['alpaca','alpaca_news','logos','sec'],symbols=[body.symbol]))
    return {'status':'queued','symbol':body.symbol,'message':'New symbol added; five-year history queued under provider budgets'}

@app.get('/scanner')
def scanner(mode:Mode='market',filter:Literal['all','above_sma200','rsi_low','recent_entry']='all',user:User=Depends(current_user)):
    data_access(user,mode)
    from .indicators import sma,rsi,relative_volume
    import pandas as pd
    with transaction() as db:
        instruments=list(db.scalars(select(Instrument)))
        result=[]
        for item in instruments:
            _,rows=load_bars(db,item.symbol,mode)
            if not rows:
                if filter=='all':result.append({'symbol':item.symbol,'name':item.name,'status':'unavailable','close':None,'rsi':None,'sma200':None,'relative_volume':None,'candidate':None,'as_of':None,'bars':0})
                continue
            f=pd.DataFrame(rows);strength=rsi(f.close).iloc[-1];average=sma(f.close,200).iloc[-1];vol=relative_volume(f.volume).iloc[-1]
            import math
            strength=float(strength) if math.isfinite(strength) else None
            average=float(average) if math.isfinite(average) else None
            vol=float(vol) if math.isfinite(vol) else None
            cfg=config_for(db,user,'strategies',StrategyConfig)
            candidates=evaluate(rows,cfg)
            last_candidate=candidates[-1] if candidates else None
            fresh_entry=any(e['kind']=='entry' and e['time']>=rows[max(0,len(rows)-5)]['timestamp'] for e in candidates)
            if filter=='above_sma200' and (average is None or rows[-1]['close']<=average):continue
            if filter=='rsi_low' and (strength is None or strength>=30):continue
            if filter=='recent_entry' and not fresh_entry:continue
            result.append({'symbol':item.symbol,'name':item.name,'status':freshness(db,rows,mode)['status'],'close':rows[-1]['close'],'rsi':strength,'sma200':average,'relative_volume':vol,'candidate':last_candidate,'as_of':rows[-1]['event_time'],'bars':len(rows)})
    return {'items':result,'source':'local SQLite cache' if mode=='market' else 'isolated synthetic data','external_calls':0,'note':'Starter/current cached universe only. Selected-universe bias; no universe-wide recommendations or ranking.'}

@app.get('/instruments/{symbol}/logo')
def company_logo(symbol:str,user:User=Depends(current_user)):
    with transaction() as db:
        logo=db.get(InstrumentLogo,symbol.upper())
        if not logo or not logo.content:raise HTTPException(404,'Verified company logo unavailable')
        return Response(content=logo.content,media_type=logo.content_type,headers={'Cache-Control':'private, max-age=86400','X-Logo-Source':logo.source})

class LogoUpload(BaseModel):
    content_base64:str=Field(max_length=700000)
    source_url:str=Field(min_length=5,max_length=500)

@app.put('/instruments/{symbol}/logo')
def upload_logo(symbol:str,body:LogoUpload,user:User=Depends(admin)):
    import base64
    from urllib.parse import urlparse
    if urlparse(body.source_url).scheme!='https':raise HTTPException(422,'Source must be an HTTPS attribution URL')
    try:content=base64.b64decode(body.content_base64,validate=True)
    except Exception:raise HTTPException(422,'Invalid image') from None
    if content.startswith(b'\x89PNG\r\n\x1a\n'):mime='image/png'
    elif content.startswith(b'\xff\xd8\xff'):mime='image/jpeg'
    else:raise HTTPException(422,'PNG or JPEG required; SVG/HTML not accepted')
    if len(content)>500000:raise HTTPException(422,'Maximum image size 500 KB')
    with transaction() as db:
        instrument(db,symbol)
        db.merge(InstrumentLogo(symbol=symbol.upper(),content=content,content_type=mime,source=body.source_url,fetched_at=now(),status='owner_supplied'))
        db.add(AuditEvent(user_id=user.id,action='logo_uploaded',detail=symbol.upper()))
    return {'ok':True}

@app.get('/heatmap')
def heatmap_data(universe:Literal['sp500','nasdaq100','russell2000','watchlist']='sp500',watchlist_id:int|None=None,mode:Mode='market',user:User=Depends(current_user)):
    data_access(user,mode)
    with transaction() as db:
        if universe=='watchlist':
            watch=db.get(Watchlist,watchlist_id) if watchlist_id else db.scalar(select(Watchlist).where(Watchlist.user_id==user.id))
            if not watch or watch.user_id!=user.id:raise HTTPException(404,'Watchlist not found')
            rows=[]
            for symbol in watch.symbols:
                _,bars_=load_bars(db,symbol,mode)
                rows.append({'symbol':symbol,'name':symbol,'sector':watch.name,'weight':1,'price':bars_[-1]['close'] if bars_ else None,'change_percent':(bars_[-1]['close']/bars_[-2]['close']-1)*100 if len(bars_)>1 else None,'as_of':bars_[-1]['event_time'] if bars_ else None,'history':[{'time':b['timestamp'],'value':b['close']} for b in bars_[-20:]],'status':'demo' if mode=='demo' else freshness(db,bars_,mode)['status']})
            return {'items':rows,'universe':watch.name,'note':'Equal-size watchlist tiles. Color = daily close change. '+('SYNTHETIC DATA.' if mode=='demo' else 'Source: local Alpaca daily cache.'),'coverage':{'total':len(rows),'priced':sum(r['price'] is not None for r in rows)},'as_of':now(),'source_url':None,'mode':mode}
        stored=db.get(HeatmapUniverse,universe)
        if not stored:return {'items':[],'universe':universe,'note':'No issuer holdings cached. Owner can refresh heatmap data.','coverage':{'total':0,'priced':0},'mode':mode}
        quotes={q.symbol:q for q in db.scalars(select(HeatmapQuote))}
        rows=[]
        for member in stored.members:
            q=quotes.get(member['symbol']) if mode=='market' else None
            rows.append(dict(member,history=q.provenance.get('recent_closes',[]) if q else [],price=q.price if q else None,change_percent=q.change_percent if q else None,as_of=q.as_of if q else None,status='unavailable' if not q or q.price is None else 'stale' if (datetime.now(timezone.utc)-datetime.fromisoformat(q.fetched_at.replace('Z','+00:00'))).total_seconds()>4*86400 else 'cached'))
        return {'items':rows,'universe':universe,'note':stored.note+' Gray tiles = missing quotes. SIP = consolidated delayed history; IEX = partial venue.'+(' Switch to provider data for source prices.' if mode=='demo' else ''),'coverage':{'total':len(rows),'priced':sum(r['price'] is not None for r in rows)},'as_of':stored.as_of,'source_url':stored.source_url,'mode':mode}

class HeatmapRefreshBody(BaseModel):
    universes:list[Literal['sp500','nasdaq100','russell2000']]=Field(default_factory=lambda:['sp500','nasdaq100','russell2000'],min_length=1,max_length=3)

@app.post('/admin/heatmap/refresh',status_code=202)
async def heatmap_refresh(body:HeatmapRefreshBody,request:Request,user:User=Depends(admin)):
    from .heatmap import refresh_heatmaps
    if refresh_lock.locked():raise HTTPException(409,'Another refresh is running; retry after it completes')
    with transaction() as db:db.add(AuditEvent(user_id=user.id,action='heatmap_refresh_requested'))
    request.app.state.refresh_task=asyncio.create_task(refresh_heatmaps(body.universes))
    return {'status':'queued'}

@app.get('/earnings')
def earnings_calendar(start:str=Query(...,pattern=r'^\d{4}-\d{2}-\d{2}$'),end:str=Query(...,pattern=r'^\d{4}-\d{2}-\d{2}$'),watchlist_id:int|None=None,scope:Literal['sp500','sp500_top50']='sp500',mode:Mode='market',user:User=Depends(current_user)):
    from datetime import date
    data_access(user,mode)
    try:a,b=date.fromisoformat(start),date.fromisoformat(end)
    except ValueError:raise HTTPException(422,'Invalid calendar date') from None
    if b<a or (b-a).days>400:raise HTTPException(422,'Calendar range must be 0–400 days')
    with transaction() as db:
        benchmark=db.get(HeatmapUniverse,'sp500')
        members=sorted(benchmark.members,key=lambda m:m['weight'],reverse=True) if benchmark else []
        symbols={m['symbol'] for m in (members[:50] if scope=='sp500_top50' else members)}
        if watchlist_id:
            w=db.get(Watchlist,watchlist_id)
            if not w or w.user_id!=user.id:raise HTTPException(404,'Watchlist not found')
            symbols=set(w.symbols)
        rows=list(db.scalars(select(EarningsEvent).where(EarningsEvent.report_date>=start,EarningsEvent.report_date<=end).order_by(EarningsEvent.report_date,EarningsEvent.symbol))) if mode=='market' else []
        if symbols is not None:rows=[r for r in rows if r.symbol in symbols]
        source=db.get(ProviderStatus,'earnings')
        from .budgets import usage
        budget=usage()['alpha_vantage']
        return {'items':[{k:getattr(r,k) for k in ['id','symbol','name','report_date','fiscal_end','eps_estimate','currency','source_url','fetched_at','status','provenance']} for r in rows],'scope':scope if not watchlist_id else 'watchlist','universe_size':len(symbols) if symbols is not None else 0,'configured':bool(settings().alpha_vantage_api_key),'budget':budget,'can_refresh':bool(settings().alpha_vantage_api_key) and not budget['paused'],'source_status':source.status if source else 'not_configured' if not settings().alpha_vantage_api_key else 'not_fetched','note':'Alpha Vantage three-month calendar. Scheduled dates may change; time of day is not supplied. No dates inferred from filings.' if mode=='market' else 'Demo does not fabricate earnings dates. Switch to provider data.'}

@app.post('/admin/earnings/refresh',status_code=202)
async def earnings_refresh(request:Request,user:User=Depends(admin)):
    from .budgets import usage
    if not settings().alpha_vantage_api_key:raise HTTPException(409,'Earnings calendar key is not configured')
    budget=usage()['alpha_vantage']
    if budget['paused']:raise HTTPException(429,f"Calendar refresh paused until {budget['resume_at']}; request budget reached. Cached dates remain available.")
    if refresh_lock.locked():raise HTTPException(409,'Another refresh is running')
    request.app.state.refresh_task=asyncio.create_task(refresh(['earnings']))
    return {'status':'queued'}

@app.post('/admin/instruments/{symbol}/profile',status_code=202)
async def refresh_profile(symbol:str,request:Request,user:User=Depends(admin)):
    from .profiles import access
    permitted=access()
    if not permitted['can_refresh']:raise HTTPException(429 if permitted['status']=='paused' else 403,permitted['reason'])
    if refresh_lock.locked():raise HTTPException(409,'Another refresh is running')
    with transaction() as db:instrument(db,symbol)
    request.app.state.refresh_task=asyncio.create_task(refresh(['company_profile'],symbols=[symbol.upper()]))
    return {'status':'queued','note':'One provider call for an uncached company profile; 24h cache; shares the Alpha Vantage app cap of five calls/day with earnings.'}


@app.get('/ipos')
def upcoming_ipos(user:User=Depends(current_user)):
    from .ipos import items
    from .budgets import usage
    with transaction() as db:
        snapshot=db.get(IPOCalendarCache,'alpha_vantage')
        status=db.get(ProviderStatus,'ipos')
        cached=[dict(row,observed_at=snapshot.fetched_at) for row in snapshot.items] if snapshot and (user.role=='admin' or settings().partner_data_display_approved) else []
        budget=usage()['alpha_vantage']
        fresh=bool(snapshot and (datetime.now(timezone.utc)-datetime.fromisoformat(snapshot.fetched_at.replace('Z','+00:00'))).total_seconds()<86400)
        return {'items':items(cached),'configured':bool(settings().alpha_vantage_api_key),'cached_at':snapshot.fetched_at if snapshot else None,'cache_fresh':fresh,'can_refresh':bool(settings().alpha_vantage_api_key) and (fresh or not budget['paused']),'budget':budget,'source_status':status.status if status else 'not_fetched','message':status.message if status else 'Broad calendar not fetched yet. Verified issuer announcements are shown separately.','note':'Expected dates and indicative price ranges can change. Research only; no IPO participation or order execution.'}

@app.post('/admin/ipos/refresh',status_code=202)
async def refresh_ipos(request:Request,user:User=Depends(admin)):
    from .budgets import usage
    with transaction() as db:
        snapshot=db.get(IPOCalendarCache,'alpha_vantage')
        if snapshot and (datetime.now(timezone.utc)-datetime.fromisoformat(snapshot.fetched_at.replace('Z','+00:00'))).total_seconds()<86400:return {'status':'cached','message':'Fresh 24-hour schedule reused; no outbound call.'}
    if not settings().alpha_vantage_api_key:raise HTTPException(409,'IPO calendar key is not configured')
    budget=usage()['alpha_vantage']
    if budget['paused']:raise HTTPException(429,f"IPO refresh paused until {budget['resume_at']}; request budget reached. Cached announcements remain available.")
    if refresh_lock.locked() or (request.app.state.refresh_task and not request.app.state.refresh_task.done()):raise HTTPException(409,'Another refresh is running')
    request.app.state.refresh_task=asyncio.create_task(refresh(['ipos']))
    return {'status':'queued'}


@app.get('/instruments/{symbol}/corporate-actions')
def corporate_action_history(symbol:str,mode:Mode='market',user:User=Depends(current_user)):
    data_access(user,mode)
    with transaction() as db:
        item=instrument(db,symbol)
        rows=list(db.scalars(select(CorporateAction).where(CorporateAction.instrument_id==item.id).order_by(CorporateAction.event_time.desc()))) if mode=='market' else []
        source=db.get(ProviderStatus,'corporate_actions')
        return {'symbol':item.symbol,'items':[{key:getattr(row,key) for key in ['id','kind','event_time','available_at','provider','payload']} for row in rows],'symbol_history':item.symbol_history if mode=='market' else [],'status':source.status if source else 'not_fetched','as_of':source.last_success if source else None,'note':'Source event dates have day-level precision; availability is first observed, not historical publication time. Symbols are not automatically merged or renamed. Raw and split-adjusted prices remain separate; not a total-return series.'}


@app.get('/quotes/intraday')
def intraday_prices(mode:Mode='market',user:User=Depends(current_user)):
    data_access(user,mode)
    if mode=='demo':return {'configured':False,'feeds':{},'session':session_status(),'refresh_interval_seconds':60,'note':'Synthetic daily charts do not contain fabricated live prices.'}
    from .intraday import get_cache
    return get_cache()

@app.post('/admin/quotes/intraday/refresh')
async def refresh_intraday_prices(user:User=Depends(admin)):
    from .intraday import refresh_if_due
    return await refresh_if_due(active_admin=True)
