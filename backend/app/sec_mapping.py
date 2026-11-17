"""Batch SEC ticker/CIK associations. A ticker match is current, not historical identity."""
from datetime import datetime,timezone
import re
from sqlalchemy import select
from .db import transaction
from .models import Instrument,InstrumentDirectory,ProviderStatus,now
from .providers import SEC,ProviderError

SOURCE='https://www.sec.gov/files/company_tickers_exchange.json'

def ticker_key(symbol):return symbol.strip().upper().replace('.','-')

def parse_ticker_directory(payload):
    if not isinstance(payload,dict) or not {'cik','ticker','name'}.issubset(payload.get('fields',[])) or not isinstance(payload.get('data'),list):raise ProviderError('SEC ticker mapping response invalid; existing mappings retained')
    fields=payload['fields'];out={};ambiguous=set()
    for values in payload['data']:
        if not isinstance(values,list) or len(values)!=len(fields):continue
        row=dict(zip(fields,values));symbol=ticker_key(str(row.get('ticker') or ''))
        if not re.fullmatch(r'[A-Z0-9][A-Z0-9.\-]{0,14}',symbol):continue
        raw_cik=row.get('cik')
        if isinstance(raw_cik,bool) or not str(raw_cik).isdigit():continue
        try:cik=str(int(raw_cik))
        except (TypeError,ValueError):continue
        if int(cik)<=0:continue
        if symbol in out and out[symbol]['cik']!=cik:ambiguous.add(symbol);continue
        out[symbol]={'cik':cik,'name':str(row['name']),'exchange':row.get('exchange'),'source':SOURCE}
    for symbol in ambiguous:out.pop(symbol,None)
    if not out:raise ProviderError('SEC ticker mapping is empty; existing mappings retained')
    return out

async def map_missing_ciks(instruments,cfg):
    """One bulk call per day, cached into the existing supported-symbol directory."""
    missing=[item for item in instruments if not item.cik]
    if not missing:return 0
    with transaction() as db:
        cached=db.get(ProviderStatus,'sec_directory')
        fresh=bool(cached and cached.last_success and (datetime.now(timezone.utc)-datetime.fromisoformat(cached.last_success.replace('Z','+00:00'))).total_seconds()<86400)
        recent_failure=bool(cached and cached.status!='ready' and cached.last_attempt and (datetime.now(timezone.utc)-datetime.fromisoformat(cached.last_attempt.replace('Z','+00:00'))).total_seconds()<3600)
        entries={ticker_key(row.symbol):row for row in db.scalars(select(InstrumentDirectory))}
        mapping={symbol:{'cik':row.payload['sec_cik']} for symbol,row in entries.items() if row.payload.get('sec_cik')}
    if not fresh and not recent_failure:
        try:
            mapping=await SEC(cfg).ticker_directory()
            observed=now()
            with transaction() as db:
                for row in db.scalars(select(InstrumentDirectory)):
                    match=mapping.get(ticker_key(row.symbol))
                    row.payload=dict(row.payload,sec_cik=match['cik'] if match else None,sec_mapping_source=SOURCE,sec_mapping_checked_at=observed)
                status=db.get(ProviderStatus,'sec_directory')
                if not status:status=ProviderStatus(code='sec_directory');db.add(status)
                status.status='ready';status.message=f'{len(mapping)} current SEC ticker mappings cached; 24-hour reuse; association scope not guaranteed by SEC.';status.last_attempt=observed;status.last_success=observed
        except ProviderError as error:
            # A failed bulk association must not prevent already mapped companies refreshing.
            with transaction() as db:
                status=db.get(ProviderStatus,'sec_directory')
                if not status:status=ProviderStatus(code='sec_directory');db.add(status)
                status.status='unavailable';status.message=str(error);status.last_attempt=now()
    count=0
    with transaction() as db:
        for item in missing:
            association=mapping.get(ticker_key(item.symbol))
            if not association:continue
            row=db.get(Instrument,item.id)
            if not row or row.cik:continue
            row.cik=association['cik'];item.cik=association['cik']
            row.symbol_history=[*row.symbol_history,{'current_symbol':row.symbol,'cik':row.cik,'observed_at':now(),'source':SOURCE,'note':'Current ticker/CIK association; not historical symbol coverage.'}]
            count+=1
    return count
