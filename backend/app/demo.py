"""Isolated deterministic SYNTHETIC series. Never written into provider price tables."""
import math
import random
from datetime import datetime,timedelta,timezone
from .schemas import Provenance

DEMO_TIME='2026-11-13T21:00:00Z'

def demo_bars(symbol: str) -> list[dict]:
    seed=sum((i+1)*ord(c) for i,c in enumerate(symbol))
    rng=random.Random(seed)
    price=55+seed%140
    start=datetime(2025,10,1,tzinfo=timezone.utc)
    end=datetime(2026,11,13,tzinfo=timezone.utc)
    rows=[]; i=0; date=start
    provenance=Provenance(source='synthetic_demo',feed='fabricated; no market feed',observed_at=DEMO_TIME,fetched_at=DEMO_TIME,delay_seconds=None,license_category='synthetic demonstration data',adjustment='synthetic',status='demo',quality_flags=['SYNTHETIC — NOT MARKET DATA']).model_dump()
    while date<=end:
        if date.weekday()<5:
            o=price
            wave=math.sin(i/13)*.003
            price=max(5,price*(1+.001+wave+rng.gauss(0,.011)))
            volume=rng.randint(12000000,45000000)*(3 if i%47==0 else 1)
            t=date.replace(hour=5).isoformat().replace('+00:00','Z')
            close=date.replace(hour=21).isoformat().replace('+00:00','Z')
            rows.append(dict(timestamp=t,open=round(o,4),high=round(max(o,price)*(1+rng.uniform(.002,.015)),4),low=round(min(o,price)*(1-rng.uniform(.002,.015)),4),close=round(price,4),volume=volume,event_time=close,available_at=close,provenance=provenance))
            i+=1
        date+=timedelta(days=1)
    return rows
