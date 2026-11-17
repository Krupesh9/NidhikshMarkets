"""Public issuer holdings as explicit index proxies; permitted delayed daily bars."""
import csv
import io
import math
import re
from datetime import datetime,timedelta,timezone
from sqlalchemy import select
from .db import transaction
from .models import HeatmapUniverse,HeatmapQuote,InstrumentDirectory,now
from .providers import HTTP,Alpaca,ProviderError
from .config import settings
from .ingestion import refresh_lock,status,start_run

QQQ_PARSER_VERSION='qqq-equities-v2'

SOURCES={
 'sp500':('IVV','S&P 500','https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf/latest-holdings.csv'),
 'nasdaq100':('QQQ','Nasdaq 100','https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46090E103/holdings/fund?idType=cusip&productType=ETF'),
 'russell2000':('IWM','Russell 2000','https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/latest-holdings.csv')}

def parse_holdings(content:bytes):
    text=content.decode('utf-8-sig')
    lines=text.splitlines();header=next((i for i,line in enumerate(lines) if line.startswith('Ticker,') or line.startswith('"Ticker",')),None)
    if header is None:raise ProviderError('Issuer holdings CSV format changed; cached universe retained')
    date_line=next((line for line in lines[:header] if 'Holdings as of' in line or 'Fund Holdings as of' in line),None)
    as_of=next(csv.reader([date_line]))[-1] if date_line else None
    if not as_of:raise ProviderError('Issuer holdings date missing')
    rows=[]
    for row in csv.DictReader(io.StringIO('\n'.join(lines[header:]))):
        if row.get('Asset Class')!='Equity':continue
        try:weight=float(row.get('Weight (%)','0').replace(',',''))
        except (ValueError,AttributeError):continue
        symbol=(row.get('Ticker') or '').strip().replace(' ','.')
        if not re.fullmatch(r'[A-Z0-9][A-Z0-9.\-]{0,11}',symbol):continue
        if weight<0 or not math.isfinite(weight):continue
        rows.append({'symbol':symbol,'name':row.get('Name',symbol),'sector':row.get('Sector') or 'Unclassified','weight':weight})
    if len(rows)<50:raise ProviderError('Issuer returned unexpectedly few equity holdings; universe not replaced')
    return as_of,rows

def parse_invesco_holdings(payload,sectors=None):
    """QQQ common stocks AND depositary receipts, excluding cash and futures."""
    if not isinstance(payload,dict):raise ProviderError('QQQ holdings response invalid; cached universe retained')
    as_of=payload.get('effectiveBusinessDate') or payload.get('effectiveDate')
    try:datetime.strptime(as_of,'%Y-%m-%d')
    except (TypeError,ValueError):raise ProviderError('QQQ holdings date invalid; cached universe retained') from None
    rows=[];seen=set();sectors=sectors or {}
    for item in payload.get('holdings',[]):
        if item.get('securityTypeCode') not in ['COM','ADR','DRNY']:continue
        symbol=str(item.get('ticker') or '').strip().upper()
        try:weight=float(item.get('percentageOfTotalNetAssets'))
        except (TypeError,ValueError):raise ProviderError('QQQ holding weight invalid; cached universe retained') from None
        if not re.fullmatch(r'[A-Z0-9][A-Z0-9.\-]{0,11}',symbol) or not math.isfinite(weight) or weight<=0:continue
        if symbol in seen:raise ProviderError('QQQ holdings contain duplicate symbols; cached universe retained')
        seen.add(symbol)
        rows.append({'symbol':symbol,'name':item.get('issuerName') or symbol,'sector':sectors.get(symbol,'Unclassified'),'weight':weight})
    if len(rows)<90:raise ProviderError('QQQ holdings response incomplete; cached universe retained')
    return as_of,rows

def store_qqq_snapshot(payload,observed_at):
    """Reconcile a previously downloaded official response, preserving observation time."""
    with transaction() as db:
        directory={row.symbol for row in db.scalars(select(InstrumentDirectory))}
        normalized={re.sub('[^A-Z0-9]','',symbol):symbol for symbol in directory}
        reference=db.get(HeatmapUniverse,'sp500')
        sectors={m['symbol']:m['sector'] for m in reference.members} if reference else {}
        as_of,rows=parse_invesco_holdings(payload,sectors)
        existing=db.get(HeatmapUniverse,'nasdaq100')
        if existing and existing.as_of>as_of:raise ProviderError('Older QQQ holdings cannot replace a newer snapshot')
        for row in rows:
            row['symbol']=normalized.get(re.sub('[^A-Z0-9]','',row['symbol']),row['symbol'])
            row['supported']=row['symbol'] in directory
        db.merge(HeatmapUniverse(code='nasdaq100',source_url=SOURCES['nasdaq100'][2],as_of=as_of,fetched_at=observed_at,members=rows,note=f'Nasdaq 100 via QQQ equity holdings proxy. ETF weights, not official index weights. Current holdings only; cash/derivatives excluded. Parser {QQQ_PARSER_VERSION}.'))
    return len(rows)

async def refresh_heatmaps(codes=None):
    if refresh_lock.locked():return {'status':'already_running'}
    async with refresh_lock:
        run=start_run('heatmap');total=0
        try:
            with transaction() as db:
                directory={s:s for s in db.scalars(select(InstrumentDirectory.symbol))}
            normalized={re.sub('[^A-Z0-9]','',s):s for s in directory}
            members=set()
            for code in codes or list(SOURCES):
                fund,label,url=SOURCES[code]
                with transaction() as db:existing=db.get(HeatmapUniverse,code)
                fresh=bool(existing and (datetime.now(timezone.utc)-datetime.fromisoformat(existing.fetched_at.replace('Z','+00:00'))).total_seconds()<86400)
                if code=='nasdaq100' and fresh and QQQ_PARSER_VERSION not in existing.note:fresh=False
                if fresh:
                    rows=existing.members
                else:
                    if code=='nasdaq100':
                        payload=await HTTP().get(url)
                        with transaction() as db:
                            reference=db.get(HeatmapUniverse,'sp500')
                            sectors={m['symbol']:m['sector'] for m in reference.members} if reference else {}
                        as_of,rows=parse_invesco_holdings(payload,sectors)
                    else:
                        content=await HTTP().get(url,raw=True)
                        as_of,rows=parse_holdings(content)
                    for row in rows:
                        row['symbol']=normalized.get(re.sub('[^A-Z0-9]','',row['symbol']),row['symbol'])
                        row['supported']=row['symbol'] in directory
                    with transaction() as db:db.merge(HeatmapUniverse(code=code,source_url=url,as_of=as_of,fetched_at=now(),members=rows,note=f'{label} via {fund} equity holdings proxy. ETF weights, not official index weights. Current holdings only; cash/derivatives excluded.'+(f' Parser {QQQ_PARSER_VERSION}.' if code=='nasdaq100' else '')))
                members.update(r['symbol'] for r in rows if r.get('supported'))
            with transaction() as db:
                fresh_quotes={q.symbol for q in db.scalars(select(HeatmapQuote)) if len(q.provenance.get('recent_closes',[]))>=2 and (datetime.now(timezone.utc)-datetime.fromisoformat(q.fetched_at.replace('Z','+00:00'))).total_seconds()<1800}
            pending=sorted(members-fresh_quotes)
            adapter=Alpaca(settings())
            for start in range(0,len(pending),250):
                batch=await adapter.bars(pending[start:start+250],days=10)
                with transaction() as db:
                    for symbol,rows in batch.items():
                        current=rows[-1] if rows else None
                        previous=rows[-2] if len(rows)>1 else None
                        db.merge(HeatmapQuote(symbol=symbol,price=current.close if current else None,change_percent=(current.close/previous.close-1)*100 if current and previous else None,as_of=current.event_time if current else None,fetched_at=now(),feed=settings().alpaca_feed,provenance=dict(current.provenance.model_dump(),recent_closes=[{'time':bar.timestamp,'value':bar.close} for bar in rows[-10:]]) if current else {'source':'Alpaca','status':'unavailable'}))
                        total+=1
            status('heatmap','ready',f'{total} daily quote snapshots updated; issuer holdings cached for 24h',total,run)
            return {'status':'ready','quotes_updated':total}
        except ProviderError as e:
            status('heatmap','unavailable',str(e),total,run)
            return {'status':'unavailable','message':str(e),'quotes_updated':total}
        except Exception:
            status('heatmap','error','Heatmap validation failed; cached data retained',total,run)
            return {'status':'error','quotes_updated':total}
