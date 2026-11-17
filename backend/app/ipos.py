"""Upcoming IPOs are schedules, never assumed listings or market prices."""
import csv,io,re
from datetime import date,datetime,timedelta,timezone
from .providers import HTTP,ProviderError
from .config import settings
from .profiles import numeric

# Manually reviewed primary-source announcement, not a synthetic calendar row.
# Preserve its observation date; do not silently label it continuously refreshed.
VERIFIED=[{'symbol':'ANT','name':'Anthropic, PBC','expected_date':'2026-11-19','pricing_date':'2026-11-18','exchange':'Nasdaq','price_low':70.0,'price_high':78.0,'currency':'USD','status':'proposed','provider':'issuer_announcement','observed_at':'2026-11-17T03:59:22.856802Z','source_url':'https://www.sec.gov/Archives/edgar/data/2130357/000162828026072949/anthropicpbc-fwpipowebsi.htm','announcement_url':'https://www.anthropic.com/news/roadshow-launch','note':'Expected timeline in SEC-filed issuer materials, subject to regulatory clearance. Indicative price range from the November 10 roadshow announcement; not a market quote or final offer price.'}]

def parse_calendar(content):
    text=content.decode('utf-8-sig')
    reader=csv.DictReader(io.StringIO(text))
    if not {'symbol','name','ipoDate'}.issubset(reader.fieldnames or []):raise ProviderError('IPO schedule unavailable; provider did not return the expected calendar CSV.')
    out=[]
    for row in reader:
        symbol=row['symbol'].strip().upper()
        if not re.fullmatch(r'[A-Z0-9.\-]{1,12}',symbol):continue
        try:stamp=date.fromisoformat(row['ipoDate']).isoformat()
        except ValueError:continue
        out.append({'symbol':symbol,'name':row['name'],'expected_date':stamp,'pricing_date':None,'exchange':row.get('exchange') or 'Not supplied','price_low':numeric(row.get('priceRangeLow')),'price_high':numeric(row.get('priceRangeHigh')),'currency':row.get('currency') or 'USD','status':'provider_scheduled','provider':'alpha_vantage','source_url':'https://www.alphavantage.co/documentation/#ipo-calendar','note':'Expected schedule may change. Inclusion does not establish that trading has begun.'})
    return out

async def fetch_calendar():
    if not settings().alpha_vantage_api_key:raise ProviderError('IPO calendar key is not configured.')
    content=await HTTP().get('https://www.alphavantage.co/query',params={'function':'IPO_CALENDAR','apikey':settings().alpha_vantage_api_key},raw=True)
    return parse_calendar(content)

def items(cached=None,at=None):
    today=at or datetime.now(timezone.utc).date()
    merged={r['symbol']:dict(r) for r in cached or []}
    for row in VERIFIED:
        # A newer provider snapshot may supersede this manually reviewed announcement.
        previous=merged.get(row['symbol'])
        if not previous or previous.get('observed_at','')<=row['observed_at']:merged[row['symbol']]=dict(row)
    return sorted([r for r in merged.values() if today.isoformat()<=r['expected_date']<=(today+timedelta(days=93)).isoformat()],key=lambda r:(r['expected_date'],r['symbol']))
