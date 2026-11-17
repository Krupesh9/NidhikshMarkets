from .providers import HTTP,ProviderError
from .config import settings

def numeric(value):
    try:
        result=float(value)
        import math
        return result if math.isfinite(result) else None
    except (ValueError,TypeError):return None

def access():
    cfg=settings()
    from .budgets import usage
    budget=usage()['alpha_vantage']
    enabled=bool(cfg.alpha_vantage_api_key and cfg.alpha_vantage_overview_enabled)
    reason=('Company profiles, analyst ratings and forward P/E require premium data access. The current free connection does not include them.' if not cfg.alpha_vantage_overview_enabled else 'Company profile key is not configured.' if not cfg.alpha_vantage_api_key else 'Refresh paused until the request budget resets.' if budget['paused'] else 'Company profiles are enabled; a 24-hour cache is reused.')
    return {'enabled':enabled,'can_refresh':enabled and not budget['paused'],'status':'premium_required' if not cfg.alpha_vantage_overview_enabled else 'not_configured' if not cfg.alpha_vantage_api_key else 'paused' if budget['paused'] else 'ready','reason':reason,'budget':budget}

async def fetch_profile(symbol):
    if not settings().alpha_vantage_overview_enabled:raise ProviderError('Company overview requires premium data access; disabled for the current free connection.')
    key=settings().alpha_vantage_api_key
    if not key:raise ProviderError('ALPHA_VANTAGE_API_KEY not configured')
    p=await HTTP().get('https://www.alphavantage.co/query',params={'function':'OVERVIEW','symbol':symbol,'apikey':key})
    if not isinstance(p,dict):raise ProviderError('Company overview returned an invalid response; cached data retained')
    if p.get('Symbol')!=symbol:
        detail=str(p.get('Information') or p.get('Note') or '').lower()
        if 'premium' in detail:raise ProviderError('Company overview requires premium access. The key does not include this endpoint.')
        if 'limit' in detail or 'frequency' in detail:raise ProviderError('Company profile provider limit reached; retry after the provider budget resets.')
        raise ProviderError('Company overview returned no data for this symbol; cached data retained.')
    fields=['MarketCapitalization','PERatio','ForwardPE','EPS','RevenueTTM','EBITDA','DividendYield','ProfitMargin','52WeekHigh','52WeekLow','AnalystTargetPrice','AnalystRatingStrongBuy','AnalystRatingBuy','AnalystRatingHold','AnalystRatingSell','AnalystRatingStrongSell']
    values={k:numeric(p.get(k)) for k in fields}
    ratings={label:int(values[key]) if values[key] is not None and values[key]>=0 else None for label,key in [('strong_sell','AnalystRatingStrongSell'),('sell','AnalystRatingSell'),('hold','AnalystRatingHold'),('buy','AnalystRatingBuy'),('strong_buy','AnalystRatingStrongBuy')]}
    return {'source':'Alpha Vantage company overview','source_url':'https://www.alphavantage.co/documentation/#company-overview','name':p.get('Name',symbol),'latest_quarter':p.get('LatestQuarter'),'sector':p.get('Sector'),'industry':p.get('Industry'),'values':values,'analyst_ratings':ratings,'note':'Provider-reported fundamentals and analyst opinion. Exact update times for ratios/ratings not supplied. LatestQuarter is a financial reporting period, not a rating timestamp. No recommendations generated.'}
