"""Outbound documented APIs only. No brokerage endpoints or article-body scraping."""
import asyncio
from dataclasses import dataclass
from datetime import datetime,timedelta,timezone
from email.utils import parsedate_to_datetime
from typing import Protocol
from urllib.parse import urlparse, quote
import httpx
import pandas as pd
import exchange_calendars as xcals
from .config import Settings
from .models import now
from .schemas import BarDTO,Provenance
from .budgets import reserve, record_result, next_delay, cooldown, BudgetExceeded

_http_locks={code:asyncio.Lock() for code in ['alpaca','sec','fred','gdelt','logos','holdings','alpha_vantage']}

class ProviderError(Exception):
    """Safe public error: never include request URL, headers, response body, or key."""

class ProviderNotFound(ProviderError):
    """A specific requested source record is missing; not an auth/rate failure."""
    status_code=404

class HistoryProvider(Protocol):
    async def bars(self,symbols:list[str],adjustment:str='split') -> dict[str,list[BarDTO]]: ...
class QuoteProvider(Protocol):
    async def quotes(self,symbols:list[str]) -> dict: ...
class FundamentalsProvider(Protocol):
    async def fundamentals(self,cik:str) -> dict: ...
class FilingsProvider(Protocol):
    async def filings(self,cik:str) -> list[dict]: ...
class NewsProvider(Protocol):
    async def news(self,company:str) -> list[dict]: ...
class MacroProvider(Protocol):
    async def observations(self,series:str) -> list[dict]: ...
class BenchmarkProvider(Protocol):
    async def bars(self,symbols:list[str],adjustment:str='split') -> dict[str,list[BarDTO]]: ...

class HTTP:
    def __init__(self,client:httpx.AsyncClient | None=None):
        self.client=client
    async def get(self,url:str,*,params=None,headers=None,binary=False,raw=False):
        code={'data.alpaca.markets':'alpaca','api.alpaca.markets':'alpaca','paper-api.alpaca.markets':'alpaca','data.sec.gov':'sec','www.sec.gov':'sec','api.stlouisfed.org':'fred','api.gdeltproject.org':'gdelt','logoapi.sh':'logos','www.ishares.com':'holdings','www.ssga.com':'holdings','dng-api.invesco.com':'holdings','www.alphavantage.co':'alpha_vantage'}.get(urlparse(url).hostname)
        if code is None:
            raise ProviderError('Unregistered provider host blocked')
        async def request(client):
            for attempt in range(4):
                await asyncio.sleep(next_delay(code))
                try:
                    reservation=reserve(code)
                except BudgetExceeded as e:
                    raise ProviderError(str(e)) from None
                try:
                    response=await client.get(url,params=params,headers=headers)
                except (httpx.TimeoutException,httpx.NetworkError) as e:
                    if attempt==3:
                        raise ProviderError('Network unavailable or request timed out; cached data retained') from None
                    await asyncio.sleep(2**attempt)
                    continue
                record_result(reservation,response.status_code)
                if response.status_code==429:
                    retry=response.headers.get('Retry-After','120')
                    try: seconds=float(retry)
                    except ValueError:
                        try: seconds=(parsedate_to_datetime(retry)-datetime.now(timezone.utc)).total_seconds()
                        except (ValueError,TypeError): seconds=120
                    cooldown(code,max(120,seconds),'Provider HTTP 429; honoring upstream cooldown')
                    raise ProviderError('Provider rate limit reached; outbound refresh paused. Local cache remains available.')
                if response.status_code==429 or response.status_code>=500:
                    if attempt==3:
                        cooldown(code,180,'Provider unavailable after bounded retries')
                        raise ProviderError(f'Provider HTTP {response.status_code}; retry later, cache retained')
                    retry=response.headers.get('Retry-After','')
                    try:
                        delay=float(retry)
                    except ValueError:
                        try:
                            delay=(parsedate_to_datetime(retry)-datetime.now(timezone.utc)).total_seconds()
                        except (ValueError,TypeError):
                            delay=2**attempt
                    if delay>60:
                        raise ProviderError('Provider requested long cooldown; retry on next scheduled run')
                    await asyncio.sleep(max(1,min(60,delay)))
                    continue
                if response.status_code==404:
                    raise ProviderNotFound('Provider HTTP 404; requested source record unavailable')
                if response.status_code!=200:
                    raise ProviderError(f'Provider HTTP {response.status_code}; check credentials and feed entitlement')
                if raw:
                    if len(response.content)>8000000:raise ProviderError('Oversized file response rejected')
                    return response.content
                if binary:
                    content_type=response.headers.get('content-type','').split(';')[0]
                    if content_type not in ['image/png','image/jpeg','image/webp','image/x-icon','image/vnd.microsoft.icon'] or len(response.content)>500000:
                        raise ProviderError('Invalid or oversized image response rejected')
                    return response.content,content_type
                try:
                    return response.json()
                except ValueError:
                    raise ProviderError('Provider returned an invalid JSON response') from None
        async with _http_locks[code]:
            if self.client:
                return await request(self.client)
            async with httpx.AsyncClient(timeout=30,follow_redirects=False) as client:
                return await request(client)

_calendar=None

def calendar():
    global _calendar
    if _calendar is None:
        _calendar=xcals.get_calendar('XNYS')
    return _calendar

def closed_session(timestamp:str, current:datetime):
    date=pd.Timestamp(timestamp).tz_convert('America/New_York').date()
    cal=calendar()
    label=pd.Timestamp(date)
    if not cal.is_session(label):
        return None
    closed=cal.session_close(label).to_pydatetime()
    return closed if closed<=current else None

def session_status(at:datetime | None=None) -> dict:
    at=at or datetime.now(timezone.utc)
    cal=calendar(); stamp=pd.Timestamp(at)
    day=pd.Timestamp(at.astimezone(__import__('zoneinfo').ZoneInfo('America/New_York')).date())
    if cal.is_session(day):
        o,c=cal.session_open(day),cal.session_close(day)
        state='open' if o<=stamp<c else 'pre-market' if stamp<o else 'closed'
        return {'status':state,'timezone':'America/New_York','regular_open':o.isoformat(),'regular_close':c.isoformat(),'as_of':at.isoformat(),'calendar':'XNYS regular session; unscheduled halts not tracked'}
    return {'status':'closed','timezone':'America/New_York','as_of':at.isoformat(),'calendar':'XNYS holiday/weekend; unscheduled halts not tracked'}

class Alpaca:
    def __init__(self,cfg:Settings,http:HTTP | None=None):
        self.cfg=cfg; self.http=http or HTTP()
    @property
    def headers(self):
        return {'APCA-API-KEY-ID':self.cfg.alpaca_api_key,'APCA-API-SECRET-KEY':self.cfg.alpaca_secret_key}
    @property
    def asset_base(self):
        return 'https://paper-api.alpaca.markets' if self.cfg.alpaca_api_key.startswith('PK') else 'https://api.alpaca.markets'
    async def directory(self):
        return await self.http.get(self.asset_base+'/v2/assets',params={'status':'active','asset_class':'us_equity'},headers=self.headers)
    async def bars(self,symbols:list[str],adjustment='split',days:int|None=None):
        if not self.cfg.alpaca_api_key or not self.cfg.alpaca_secret_key:
            raise ProviderError('Alpaca credentials not configured')
        current=datetime.now(timezone.utc)
        cutoff=current-timedelta(minutes=16) if self.cfg.alpaca_feed=='sip' else current
        # Five visible years plus 400 calendar days for SMA200 warm-up.
        params={'symbols':','.join(symbols),'timeframe':'1Day','start':(current-timedelta(days=days if days is not None else 366*self.cfg.history_years+400)).isoformat(),'end':cutoff.isoformat(),'adjustment':adjustment,'feed':self.cfg.alpaca_feed,'limit':10000,'sort':'asc'}
        out={s:[] for s in symbols}; seen=set()
        for _ in range(100):
            payload=await self.http.get('https://data.alpaca.markets/v2/stocks/bars',params=params,headers=self.headers)
            fetched=now()
            for symbol,rows in (payload.get('bars') or {}).items():
                if symbol not in out:
                    continue
                for bar in rows:
                    closed=closed_session(bar['t'],cutoff)
                    if closed is None:
                        continue
                    prov=Provenance(source='alpaca',feed=self.cfg.alpaca_feed,observed_at=fetched,fetched_at=fetched,delay_seconds=900 if self.cfg.alpaca_feed=='sip' else 0,adjustment=adjustment,quality_flags=['partial venue volume'] if self.cfg.alpaca_feed=='iex' else [])
                    available=closed+timedelta(seconds=prov.delay_seconds or 0)
                    if available>current:
                        continue
                    out[symbol].append(BarDTO(timestamp=bar['t'],open=bar['o'],high=bar['h'],low=bar['l'],close=bar['c'],volume=bar['v'],event_time=closed.isoformat(),available_at=available.isoformat(),provenance=prov))
            token=payload.get('next_page_token')
            if not token:
                return out
            if token in seen:
                raise ProviderError('Provider repeated a pagination token')
            seen.add(token); params['page_token']=token
        raise ProviderError('History pagination limit reached; incomplete refresh not saved')
    async def quotes(self,symbols:list[str]):
        # Explicit IEX-only quotes; no attempt to access realtime SIP without entitlement.
        return await self.http.get('https://data.alpaca.markets/v2/stocks/quotes/latest',params={'symbols':','.join(symbols),'feed':'iex'},headers=self.headers)
    async def news(self,symbols:list[str]):
        result=await self.http.get('https://data.alpaca.markets/v1beta1/news',params={'symbols':','.join(symbols),'limit':50,'include_content':'false','start':(datetime.now(timezone.utc)-timedelta(days=14)).isoformat(),'sort':'desc'},headers=self.headers)
        rows=[]
        for item in result.get('news',[]):
            if urlparse(item.get('url','')).scheme not in ['http','https']:continue
            published=item.get('created_at')
            rows.append({'title':item['headline'],'url':item['url'],'publisher':item.get('source') or 'Source unspecified by Alpaca','published_at':published,'available_at':published or now(),'fetched_at':now(),'provider':'alpaca_news','payload':{'source':'Alpaca News','publisher':item.get('source'),'symbols':item.get('symbols',[]),'source_last_updated':item.get('updated_at'),'publication_time':published,'license_category':'personal research; underlying publisher rights; partner display unverified','quality_flags':[] if published else ['publication time missing']}})
        return rows
    async def corporate_actions(self,symbols:list[str],start:str|None=None,end:str|None=None):
        if not self.cfg.alpaca_api_key or not self.cfg.alpaca_secret_key:raise ProviderError('Market data credentials not configured')
        current=datetime.now(timezone.utc).date()
        params={'symbols':','.join(symbols),'start':start or (current-timedelta(days=366*self.cfg.history_years+400)).isoformat(),'end':end or current.isoformat(),'limit':1000,'sort':'asc','data_quality':'complete'}
        out=[];seen=set()
        for _ in range(50):
            payload=await self.http.get('https://data.alpaca.markets/v1/corporate-actions',params=params,headers=self.headers)
            if not isinstance(payload,dict) or not isinstance(payload.get('corporate_actions'),dict):raise ProviderError('Corporate action response invalid; cached actions retained')
            from .corporate_actions import normalize_actions
            out.extend(normalize_actions(payload['corporate_actions'],symbols))
            token=payload.get('next_page_token')
            if not token:return out
            if token in seen:raise ProviderError('Corporate action pagination repeated; incomplete refresh not saved')
            seen.add(token);params['page_token']=token
        raise ProviderError('Corporate action pagination limit reached; incomplete refresh not saved')

    async def logo(self,symbol:str):
        return await self.http.get(f'https://data.alpaca.markets/v1beta1/logos/{symbol}',params={'placeholder':'false'},headers=self.headers,binary=True)

class SEC:
    def __init__(self,cfg:Settings,http:HTTP | None=None):
        self.cfg=cfg; self.http=http or HTTP()
    async def get(self,path):
        if '@' not in self.cfg.sec_user_agent:
            raise ProviderError('Configure SEC_USER_AGENT with application name and contact email')
        await asyncio.sleep(.3)
        return await self.http.get('https://data.sec.gov/'+path,headers={'User-Agent':self.cfg.sec_user_agent,'Accept-Encoding':'gzip, deflate'})
    async def ticker_directory(self):
        if '@' not in self.cfg.sec_user_agent:raise ProviderError('Configure SEC_USER_AGENT with application name and contact email')
        payload=await self.http.get('https://www.sec.gov/files/company_tickers_exchange.json',headers={'User-Agent':self.cfg.sec_user_agent,'Accept-Encoding':'gzip, deflate'})
        from .sec_mapping import parse_ticker_directory
        return parse_ticker_directory(payload)

    async def filings(self,cik:str):
        p=await self.get(f'submissions/CIK{int(cik):010d}.json')
        recent=p.get('filings',{}).get('recent',{})
        out=[]
        for i,form in enumerate(recent.get('form',[])):
            if form not in ['4','4/A','8-K','10-Q','10-K','13F-HR','13F-HR/A']:
                continue
            a=recent['accessionNumber'][i]; document=recent['primaryDocument'][i]
            accepted=recent.get('acceptanceDateTime',[])
            acceptance=accepted[i] if i<len(accepted) else None
            # No midnight invention. Missing acceptance uses first-observed time, flagged.
            available=acceptance or now()
            if acceptance and not acceptance.endswith('Z') and '+' not in acceptance[10:]:
                available=datetime.fromisoformat(acceptance).replace(tzinfo=__import__('zoneinfo').ZoneInfo('America/New_York')).astimezone(timezone.utc).isoformat()
            out.append({'accession':a,'form':form,'url':f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/{a.replace("-","")}/{quote(document,safe="/")}',
                'event_time':recent['filingDate'][i],'available_at':available,'fetched_at':now(),
                'payload':{'source':'SEC EDGAR','acceptance_time':acceptance,'report_date':recent.get('reportDate',['']*len(recent['form']))[i],'quality_flags':[] if acceptance else ['acceptance unknown; available_at is first observed'],'note':'13F is delayed holdings disclosure. Form 4 is public disclosure, not live insider activity.'}})
            if len(out)>=40:
                break
        return out
    async def fundamentals(self,cik:str):
        p=await self.get(f'api/xbrl/companyfacts/CIK{int(cik):010d}.json')
        fields={}
        for tag in ['Revenues','RevenueFromContractWithCustomerExcludingAssessedTax','NetIncomeLoss','Assets','Liabilities','EarningsPerShareDiluted','CommonStockSharesOutstanding']:
            fact=p.get('facts',{}).get('us-gaap',{}).get(tag,{})
            units=fact.get('units',{})
            observations=[dict(v,unit=unit) for unit,values in units.items() for v in values if v.get('filed','')<=now()[:10] and v.get('form') in ['10-Q','10-K']]
            if observations:
                # Latest period first, then latest filed revision. Not point-in-time historical fundamentals.
                v=max(observations,key=lambda x:(x.get('end',''),x.get('filed','')))
                fields[tag]=v
        shares=p.get('facts',{}).get('dei',{}).get('EntityCommonStockSharesOutstanding',{}).get('units',{}).get('shares',[])
        shares=[v for v in shares if v.get('filed','')<=now()[:10]]
        if shares:
            fields['EntityCommonStockSharesOutstanding']=dict(max(shares,key=lambda v:(v.get('end',''),v.get('filed',''))),unit='shares')
        from .financials import trailing_eps
        eps=p.get('facts',{}).get('us-gaap',{}).get('EarningsPerShareDiluted',{}).get('units',{}).get('USD/shares',[])
        eps=[v for v in eps if v.get('filed','')<=now()[:10]]
        financial_history={}
        for tag in ['Revenues','RevenueFromContractWithCustomerExcludingAssessedTax','NetIncomeLoss','Assets','Liabilities']:
            values=p.get('facts',{}).get('us-gaap',{}).get(tag,{}).get('units',{}).get('USD',[])
            unique={}
            for v in values:
                if v.get('form') not in ['10-Q','10-K']:continue
                key=(v.get('start',''),v.get('end',''))
                if key not in unique or v.get('filed','')>unique[key].get('filed',''):unique[key]=v
            financial_history[tag]=sorted(unique.values(),key=lambda v:v.get('end',''),reverse=True)[:12]
        return {'cik':str(int(cik)),'ttm_eps':trailing_eps(eps),'financial_history':financial_history,'source':'SEC companyfacts','facts':fields,'note':'Latest reported facts, including revisions; periods may differ. Not TTM ratios or a point-in-time historical snapshot. SEC filing date has day-level precision.','fetched_at':now()}

class FRED:
    def __init__(self,cfg:Settings,http:HTTP | None=None):
        self.cfg=cfg; self.http=http or HTTP()
    async def observations(self,series:str):
        if not self.cfg.fred_api_key:
            raise ProviderError('FRED key not configured')
        p=await self.http.get('https://api.stlouisfed.org/fred/series/observations',params={'api_key':self.cfg.fred_api_key,'file_type':'json','series_id':series,'sort_order':'desc','limit':60})
        fetched=now(); out=[]
        for o in p.get('observations',[]):
            if o['value']=='.':
                continue
            out.append({'series_id':series,'event_time':o['date'],'available_at':fetched,'fetched_at':fetched,'revision':o['realtime_start'],'value':float(o['value']),
                'payload':{'source':'FRED','realtime_start':o['realtime_start'],'realtime_end':o['realtime_end'],'release_time':None,'quality_flags':['latest vintage; intraday release time unavailable','available_at conservatively first observed'],'license_category':'FRED terms and underlying series restrictions apply','units':'percent' if series in ['DGS10','FEDFUNDS'] else 'index' if series=='CPIAUCSL' else 'USD per barrel'}})
        return out

class GDELT:
    def __init__(self,http:HTTP | None=None):
        self.http=http or HTTP()
    async def news(self,company:str):
        return await self._query(f'"{company}" sourcelang:english',15)
    async def news_batch(self,companies:list[str]):
        expression='('+' OR '.join(f'"{name}"' for name in companies)+') sourcelang:english'
        return await self._query(expression,75)
    async def _query(self,query:str,limit:int):
        p=await self.http.get('https://api.gdeltproject.org/api/v2/doc/doc',params={'query':query,'mode':'artlist','format':'json','maxrecords':limit,'timespan':'7d','sort':'datedesc'})
        out=[]
        for a in p.get('articles',[]):
            if urlparse(a.get('url','')).scheme not in ['http','https']:
                continue
            seen=a.get('seendate'); observed=None
            if seen:
                try:
                    observed=datetime.strptime(seen,'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).isoformat()
                except ValueError:
                    pass
            out.append({'title':a.get('title','Untitled'),'url':a['url'],'publisher':a.get('domain','Unknown publisher'),'published_at':None,'available_at':observed or now(),'fetched_at':now(),'provider':'gdelt',
                'payload':{'source':'GDELT discovery','seen_at':observed,'publication_time':None,'quality_flags':['publication time not supplied; showing discovery time','company-name matching may be noisy'],'license_category':'headline metadata and original links only; publisher rights retained'}})
        return out

class YahooDisabled:
    async def bars(self,*args,**kwargs):
        raise ProviderError('Yahoo adapter disabled. No unofficial endpoints are contacted. Terms review and explicit personal-use implementation required.')
