"""Demand-driven price caches. Daily chart bars and signal inputs are never mutated."""
import asyncio,math
from datetime import datetime,timedelta,timezone
import pandas as pd
from sqlalchemy import select
from .config import settings
from .db import transaction
from .models import IntradayCache,Instrument,PriceBar,CorporateAction
from .providers import HTTP,Alpaca,ProviderError,session_status,calendar
from .budgets import usage

FEEDS=('delayed_sip','iex')
LOCK=asyncio.Lock()
LIMIT=100

def stamp(value):return value.astimezone(timezone.utc).isoformat().replace('+00:00','Z')
def parsed(value):
    try:
        t=datetime.fromisoformat(value.replace('Z','+00:00'))
        return t.astimezone(timezone.utc) if t.tzinfo else None
    except (TypeError,ValueError,AttributeError):return None

def positive(value):
    try:v=float(value)
    except (TypeError,ValueError):return None
    return v if math.isfinite(v) and v>0 else None

def baselines(instruments,at):
    day=pd.Timestamp(at.astimezone(__import__('zoneinfo').ZoneInfo('America/New_York')).date())
    cal=calendar()
    previous=cal.previous_session(day) if cal.is_session(day) else cal.date_to_session(day,direction='previous')
    expected=cal.session_close(previous).to_pydatetime()
    out={}
    with transaction() as db:
        for instrument in instruments:
            row=db.scalar(select(PriceBar).where(PriceBar.instrument_id==instrument.id,PriceBar.provider=='alpaca',PriceBar.feed=='sip',PriceBar.adjustment=='split',PriceBar.timeframe=='1d').order_by(PriceBar.timestamp.desc()).limit(1))
            split=db.scalar(select(CorporateAction.id).where(CorporateAction.instrument_id==instrument.id,CorporateAction.event_time==day.date().isoformat(),CorporateAction.kind.in_(['forward_splits','reverse_splits','unit_splits'])).limit(1))
            if row and not split and parsed(row.event_time)==expected and positive(row.close):out[instrument.symbol]=(row.close,row.event_time)
    return out

def normalize(payload,feed,symbols,at,basis):
    if not isinstance(payload,dict):raise ProviderError('Price response is invalid; cached prices retained')
    if feed=='delayed_sip':
        if not isinstance(payload.get('bars'),dict) or payload.get('next_page_token'):raise ProviderError('Price batch incomplete; cached prices retained')
        source=payload['bars']
    else:source=payload
    out={}
    for symbol in symbols:
        if feed=='delayed_sip':
            rows=source.get(symbol) or []
            if not isinstance(rows,list):continue
            candidates=[]
            for row in rows:
                if not isinstance(row,dict):continue
                start=parsed(row.get('t'));value=positive(row.get('c'))
                if start and value and start+timedelta(minutes=1)<=at-timedelta(minutes=15):candidates.append((start+timedelta(minutes=1),value))
            if not candidates:continue
            event,price=max(candidates,key=lambda item:item[0])
        else:
            snapshot=source.get(symbol)
            if not isinstance(snapshot,dict):continue
            trade=snapshot.get('latestTrade')
            if not isinstance(trade,dict):continue
            event=parsed(trade.get('t'));price=positive(trade.get('p'))
            if not event or not price or event>at+timedelta(seconds=5):continue
        previous=basis.get(symbol)
        age=(at-event).total_seconds()
        out[symbol]={'price':price,'as_of':stamp(event),'interval_end':stamp(event) if feed=='delayed_sip' else None,'feed':feed,'coverage':'consolidated delayed' if feed=='delayed_sip' else 'IEX exchange only','delay_seconds':max(0,int(age)),'price_type':'minute_close' if feed=='delayed_sip' else 'latest_trade','status':'stale' if age>(1200 if feed=='delayed_sip' else 180) else 'cached','previous_close':previous[0] if previous else None,'previous_close_as_of':previous[1] if previous else None,'change_percent':(price/previous[0]-1)*100 if previous else None,'change_basis':'previous completed consolidated session close' if previous else 'Previous session baseline unavailable or split-day adjustment pending'}
    return out

def get_cache(*,at=None):
    at=at or datetime.now(timezone.utc);cfg=settings();session=session_status(at);budget=usage()['alpaca'];feeds={}
    with transaction() as db:
        for feed in FEEDS:
            row=db.get(IntradayCache,feed)
            last=parsed(row.last_attempt) if row else None
            next_at=last+timedelta(seconds=cfg.intraday_refresh_seconds) if last else at
            status='disabled' if not cfg.intraday_enabled else 'market_closed' if session['status']!='open' else 'budget_paused' if budget['paused'] else row.status if row else 'not_fetched'
            items={}
            for symbol,item in (row.items if row else {}).items():
                event=parsed(item.get('as_of'));age=(at-event).total_seconds() if event else float('inf')
                items[symbol]=dict(item,status='stale' if age>(1200 if feed=='delayed_sip' else 180) else item.get('status','cached'),delay_seconds=max(0,int(age)) if math.isfinite(age) else None)
            feeds[feed]={'items':items,'status':status,'cache_status':row.status if row else 'not_fetched','message':row.message if row else 'No intraday prices fetched yet.','fetched_at':row.fetched_at if row else None,'next_refresh_at':stamp(next_at),'coverage':'Consolidated, about 15–16 minutes delayed' if feed=='delayed_sip' else 'Latest IEX trades; limited exchange coverage'}
    return {'configured':cfg.intraday_enabled,'feeds':feeds,'refresh_interval_seconds':cfg.intraday_refresh_seconds,'session':session,'budget':budget,'coverage_limit':LIMIT,'note':'Two independent price feeds. One broad batch per feed per interval, shared across clients. Daily charts/signals retain completed daily bars; no intraday prices are written into them.'}

async def refresh_if_due(*,active_admin=False,at=None):
    fixed_time=at is not None
    at=at or datetime.now(timezone.utc);cfg=settings();session=session_status(at)
    if not active_admin or not cfg.intraday_enabled or session['status']!='open':return get_cache(at=at)
    async with LOCK:
        if not fixed_time:at=datetime.now(timezone.utc);session=session_status(at)
        if session['status']!='open':return get_cache(at=at)
        with transaction() as db:instruments=list(db.scalars(select(Instrument).where(Instrument.active==True).order_by(Instrument.id).limit(LIMIT)))
        symbols=[i.symbol for i in instruments]
        if not symbols:return get_cache(at=at)
        basis=baselines(instruments,at)
        for feed in FEEDS:
            if not fixed_time:
                at=datetime.now(timezone.utc);session=session_status(at)
                if session['status']!='open':break
            with transaction() as db:
                row=db.get(IntradayCache,feed)
                previous=parsed(row.last_attempt) if row else None
                if previous and (at-previous).total_seconds()<cfg.intraday_refresh_seconds:continue
                if not row:row=IntradayCache(feed=feed,status='not_fetched',message='',items={});db.add(row)
                if feed=='delayed_sip' and at<parsed(session['regular_open'])+timedelta(minutes=16):
                    row.status='waiting_for_delayed_session';row.message='Waiting for the first completed delayed prices from this session.';continue
                if usage()['alpaca']['paused']:continue
                row.last_attempt=stamp(at)
            try:
                http=HTTP();headers=Alpaca(cfg).headers
                if feed=='delayed_sip':
                    payload=await http.get('https://data.alpaca.markets/v2/stocks/bars',params={'symbols':','.join(symbols),'timeframe':'1Min','feed':'sip','adjustment':'raw','start':stamp(at-timedelta(minutes=30)),'end':stamp(at-timedelta(minutes=16)),'limit':10000,'sort':'asc'},headers=headers)
                else:payload=await http.get('https://data.alpaca.markets/v2/stocks/snapshots',params={'symbols':','.join(symbols),'feed':'iex'},headers=headers)
                received=at if fixed_time else datetime.now(timezone.utc)
                items=normalize(payload,feed,symbols,received,basis)
                with transaction() as db:
                    row=db.get(IntradayCache,feed);row.items=items;row.fetched_at=stamp(received);row.status='cached' if items else 'unavailable';row.message=f'{len(items)} / {len(symbols)} researched symbols returned. Missing trades stay unavailable.'
            except ProviderError as error:
                with transaction() as db:row=db.get(IntradayCache,feed);row.status='error';row.message=str(error)
        return get_cache(at=at if fixed_time else None)
