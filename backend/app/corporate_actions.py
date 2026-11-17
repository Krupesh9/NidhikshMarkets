"""Provider corporate-action observations, separate from price adjustment calculations."""
from datetime import date
import math
from sqlalchemy import select
from .models import CorporateAction,Instrument,now
from .providers import ProviderError

KINDS={'forward_splits','reverse_splits','unit_splits','cash_dividends','stock_dividends','spin_offs','cash_mergers','stock_mergers','stock_and_cash_mergers','redemptions','name_changes','worthless_removals','rights_distributions','partial_calls','reorganizations','capital_gains_distributions'}

def normalize_actions(groups,symbols):
    if not isinstance(groups,dict):raise ProviderError('Corporate actions response invalid')
    wanted=set(symbols);out=[]
    for kind,actions in groups.items():
        if kind not in KINDS:continue
        if not isinstance(actions,list):raise ProviderError('Corporate action group is invalid')
        for action in actions:
            if not isinstance(action,dict) or not action.get('id'):raise ProviderError('Corporate action identifier missing')
            involved={str(action.get(k) or '') for k in ['symbol','old_symbol','new_symbol','source_symbol','acquirer_symbol','acquiree_symbol']}&wanted
            if not involved:continue
            stamp=action.get('ex_date') or action.get('effective_date') or action.get('process_date')
            try:stamp=date.fromisoformat(stamp).isoformat()
            except (TypeError,ValueError):raise ProviderError('Corporate action date invalid') from None
            for field in ['new_rate','old_rate','rate','cash_rate','acquirer_rate','acquiree_rate','source_rate']:
                if action.get(field) is not None:
                    try:value=float(action[field])
                    except (TypeError,ValueError):raise ProviderError('Corporate action rate invalid') from None
                    if not math.isfinite(value) or value<0:raise ProviderError('Corporate action rate invalid')
            for symbol in sorted(involved):out.append({'symbol':symbol,'kind':kind,'event_time':stamp,'source_id':str(action['id']),'data':action})
    return out

def persist_actions(db,rows,observed_at=None):
    """Idempotent by provider identifier; revisions retained, earliest availability preserved."""
    observed=observed_at or now();changed=0
    instruments={row.symbol:row for row in db.scalars(select(Instrument))}
    for row in rows:
        instrument=instruments.get(row['symbol'])
        if not instrument:continue
        existing=db.scalar(select(CorporateAction).where(CorporateAction.instrument_id==instrument.id,CorporateAction.provider=='alpaca',CorporateAction.payload['source_id'].as_string()==row['source_id']))
        payload={'source_id':row['source_id'],'source_url':'https://docs.alpaca.markets/us/reference/corporateactions-1','data':row['data'],'observed_at':observed,'quality_flags':['Event date has day-level precision','Source publication time unavailable; available_at is first observed'],'note':'Corporate-action observation only. Prices retain provider raw/split adjustment semantics; dividends are not a total-return adjustment.'}
        if existing:
            if existing.payload.get('data')==row['data']:continue
            payload['revisions']=[*existing.payload.get('revisions',[]),{'observed_at':existing.payload.get('observed_at',existing.available_at),'data':existing.payload.get('data')}]
            existing.payload=payload;existing.event_time=row['event_time'];existing.kind=row['kind']
        else:db.add(CorporateAction(instrument_id=instrument.id,event_time=row['event_time'],available_at=observed,kind=row['kind'],provider='alpaca',payload=payload))
        if row['kind']=='name_changes':
            event={'old_symbol':row['data'].get('old_symbol'),'new_symbol':row['data'].get('new_symbol'),'process_date':row['data'].get('process_date'),'source_id':row['source_id'],'source':'Alpaca corporate actions','observed_at':observed,'note':'Observed source event; instrument is not automatically renamed or merged.'}
            history=[item for item in instrument.symbol_history if item.get('source_id')!=row['source_id']]
            instrument.symbol_history=[*history,event]
        changed+=1
    return changed
