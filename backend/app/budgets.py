"""Persistent request accounting. Reservations happen BEFORE every outbound attempt."""
from datetime import datetime,timedelta,timezone
from threading import Lock
from sqlalchemy import select,func,delete
from .db import transaction
from .models import ProviderRequest,ProviderCooldown,now

# App-imposed conservative caps, NOT provider contractual limits.
POLICY={'alpaca':{'minute':60,'day':1000,'spacing':.4},'fred':{'minute':30,'day':60,'spacing':2},'sec':{'minute':90,'day':1000,'spacing':.6},'gdelt':{'minute':8,'day':180,'spacing':6}}
lock=Lock()

class BudgetExceeded(Exception):
    pass

def iso(value):
    return value.isoformat().replace('+00:00','Z')

def _usage(db,code,at):
    minute=db.scalar(select(func.count()).select_from(ProviderRequest).where(ProviderRequest.provider==code,ProviderRequest.at>iso(at-timedelta(seconds=60))))
    day=db.scalar(select(func.count()).select_from(ProviderRequest).where(ProviderRequest.provider==code,ProviderRequest.at>=iso(at.replace(hour=0,minute=0,second=0,microsecond=0))))
    latest=db.scalar(select(ProviderRequest.at).where(ProviderRequest.provider==code).order_by(ProviderRequest.at.desc()).limit(1))
    cooldown=db.get(ProviderCooldown,code)
    return minute,day,latest,cooldown

def reserve(code,at=None):
    if code not in POLICY:
        raise BudgetExceeded('Unregistered provider; outbound request blocked')
    at=at or datetime.now(timezone.utc);policy=POLICY[code]
    with lock,transaction() as db:
        minute,day,latest,cooldown=_usage(db,code,at)
        if cooldown and cooldown.until>iso(at):
            raise BudgetExceeded(f'{code} refresh paused until {cooldown.until}: {cooldown.reason}. Local data remains available.')
        if minute>=policy['minute'] or day>=policy['day']:
            first=db.scalar(select(ProviderRequest.at).where(ProviderRequest.provider==code,ProviderRequest.at>iso(at-timedelta(seconds=60))).order_by(ProviderRequest.at).limit(1))
            until=iso(at.replace(hour=0,minute=0,second=0,microsecond=0)+timedelta(days=1)) if day>=policy['day'] else iso(datetime.fromisoformat(first.replace('Z','+00:00'))+timedelta(seconds=61))
            existing=db.get(ProviderCooldown,code)
            if existing:
                existing.until=until;existing.reason='App request budget reached'
            else:db.add(ProviderCooldown(code=code,until=until,reason='App request budget reached'))
            blocked=until
        else:
            row=ProviderRequest(provider=code,at=iso(at));db.add(row);db.flush()
            return row.id
    raise BudgetExceeded(f'{code} refresh paused until {blocked}: app request budget reached. Local data remains available.')

def next_delay(code):
    with transaction() as db:
        latest=db.scalar(select(ProviderRequest.at).where(ProviderRequest.provider==code).order_by(ProviderRequest.at.desc()).limit(1))
    if not latest:return 0
    elapsed=(datetime.now(timezone.utc)-datetime.fromisoformat(latest.replace('Z','+00:00'))).total_seconds()
    return max(0,max(POLICY[code]['spacing'],60/POLICY[code]['minute']+.05)-elapsed)

def record_result(id,status_code):
    with transaction() as db:
        row=db.get(ProviderRequest,id)
        if row:row.status_code=status_code

def cooldown(code,seconds,reason):
    until=iso(datetime.now(timezone.utc)+timedelta(seconds=max(seconds,60)))
    with transaction() as db:
        row=db.get(ProviderCooldown,code)
        if row:
            if row.until<until:row.until=until
            row.reason=reason
        else:db.add(ProviderCooldown(code=code,until=until,reason=reason))

def usage():
    at=datetime.now(timezone.utc);out={}
    with transaction() as db:
        for code,policy in POLICY.items():
            minute,day,latest,c=_usage(db,code,at)
            resume=c.until if c and c.until>iso(at) else None
            reason=c.reason if resume else None
            if day>=policy['day']:
                resume=max(resume or '',iso(at.replace(hour=0,minute=0,second=0,microsecond=0)+timedelta(days=1)));reason='App request budget reached'
            elif minute>=policy['minute']:
                first=db.scalar(select(ProviderRequest.at).where(ProviderRequest.provider==code,ProviderRequest.at>iso(at-timedelta(seconds=60))).order_by(ProviderRequest.at).limit(1))
                resume=max(resume or '',iso(datetime.fromisoformat(first.replace('Z','+00:00'))+timedelta(seconds=61)));reason='App request budget reached'
            paused=bool(resume)
            out[code]={'minute_used':minute,'minute_limit':policy['minute'],'day_used':day,'day_limit':policy['day'],'minute_remaining':max(0,policy['minute']-minute),'day_remaining':max(0,policy['day']-day),'paused':paused,'resume_at':resume,'reason':reason,'last_call':latest,'day_resets_at':iso(at.replace(hour=0,minute=0,second=0,microsecond=0)+timedelta(days=1)),'note':'Conservative application caps; resets at UTC midnight. Other apps using the same key are not counted.'}
    return out

POLICY.update({'logos':{'minute':15,'day':300,'spacing':1},'holdings':{'minute':6,'day':30,'spacing':2},'alpha_vantage':{'minute':2,'day':5,'spacing':30}})
