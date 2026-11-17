import csv,io,math
from datetime import date
from .providers import HTTP,ProviderError
from .config import settings

def parse_calendar(content:bytes):
    text=content.decode('utf-8-sig')
    if not text.startswith('symbol,'):raise ProviderError('Calendar provider returned no CSV data; verify key, entitlement, and rate limits')
    rows=[]
    for item in csv.DictReader(io.StringIO(text)):
        try:report=date.fromisoformat(item['reportDate']).isoformat()
        except (ValueError,KeyError):continue
        try:estimate=float(item.get('estimate',''))
        except ValueError:estimate=None
        if estimate is not None and not math.isfinite(estimate):estimate=None
        rows.append({'symbol':item['symbol'],'name':item.get('name',item['symbol']),'report_date':report,'fiscal_end':item.get('fiscalDateEnding') or None,'eps_estimate':estimate,'currency':item.get('currency') or 'USD','provider':'alpha_vantage','source_url':'https://www.alphavantage.co/documentation/#earnings-calendar','status':'provider_scheduled','provenance':{'source':'Alpha Vantage earnings calendar','release_time':None,'note':'Scheduled date may change. Time of day and company-confirmed status not supplied. Estimates are provider figures, not reported results.'}})
    return rows

async def fetch_calendar():
    if not settings().alpha_vantage_api_key:raise ProviderError('Optional earnings calendar needs ALPHA_VANTAGE_API_KEY in the backend .env. No dates are fabricated.')
    content=await HTTP().get('https://www.alphavantage.co/query',params={'function':'EARNINGS_CALENDAR','horizon':'3month','apikey':settings().alpha_vantage_api_key},raw=True)
    return parse_calendar(content)
