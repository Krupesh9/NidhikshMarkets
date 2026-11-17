"""Latest reported facts. No analyst consensus or invented valuation inputs."""
from datetime import date

def trailing_eps(records):
    quarters={}
    for v in records:
        try:days=(date.fromisoformat(v['end'])-date.fromisoformat(v['start'])).days
        except (ValueError,KeyError):continue
        if not 70<=days<=110:continue
        key=(v['start'],v['end'])
        if key not in quarters or v.get('filed','')>quarters[key].get('filed',''):quarters[key]=v
    recent=sorted(quarters.values(),key=lambda v:v['end'])[-4:]
    if len(recent)!=4:return None
    for previous,current in zip(recent,recent[1:]):
        if not 0<(date.fromisoformat(current['start'])-date.fromisoformat(previous['end'])).days<=7:return None
    return {'value':sum(v['val'] for v in recent),'period_start':recent[0]['start'],'period_end':recent[-1]['end'],'filed_dates':[v.get('filed') for v in recent],'method':'Sum of four explicitly reported non-overlapping quarterly diluted EPS facts. No annual-minus-YTD estimation.','quarters':recent}
