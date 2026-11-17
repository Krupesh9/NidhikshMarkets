'use client';
import {Info} from 'lucide-react';
import {asOf,dateLabel,money} from '@/lib/api';

type Props={range:string;history:any;quote:any;symbol:string;loading:boolean};
export default function PeriodReturn({range,history,quote,symbol,loading}:Props){
 const first=history?.bars?.[0];
 const start=first?.close,end=quote?.price;
 const startTime=first?.event_time||first?.timestamp,endTime=quote?.as_of;
 const valid=!loading&&history?.symbol===symbol&&history?.supported_ranges?.includes(range)&&typeof start==='number'&&Number.isFinite(start)&&start>0&&typeof end==='number'&&Number.isFinite(end)&&end>0&&Number.isFinite(Date.parse(startTime))&&Number.isFinite(Date.parse(endTime))&&Date.parse(endTime)>=Date.parse(startTime);
 const difference=valid?end-start:null,percent=valid?(end/start-1)*100:null;
 const direction=percent==null?'neutral':percent>0?'up':percent<0?'down':'neutral';
 return <section className={`period-return ${direction}`} aria-label={`${range.toUpperCase()} price change`} aria-live="polite" aria-busy={loading}>
  <div className="period-return-heading"><span>{range.toUpperCase()} price change</span><details className="period-return-info"><summary aria-label="How period price change is calculated"><Info size={14}/></summary><p>Latest available price ÷ the first daily close in the selected chart period, minus 1. Starting prices are split-adjusted. This is price change; dividends are excluded. The actual starting date and latest quote time are shown below.</p></details></div>
  {valid?<><div className="period-return-result"><strong>{percent!>=0?'+':''}{percent!.toFixed(2)}%</strong><span>{difference!>=0?'+':'−'}{money(Math.abs(difference!))} per share</span></div><p>From {money(start)} on <time dateTime={first.timestamp}>{dateLabel(first.timestamp.slice(0,10))}</time> to the latest available quote.</p><small>Quote as of {asOf(endTime)}{quote.source==='demo'?' · Synthetic demonstration':''}</small></>:<p>{loading?`Calculating ${range.toUpperCase()} change…`:'Period comparison unavailable · a valid starting close and newer quote are required.'}</p>}
 </section>;
}
