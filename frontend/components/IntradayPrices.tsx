'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Info} from 'lucide-react';
import {api,asOf} from '@/lib/api';
export function useIntradayPrices({ready,mode,admin,sessionStatus,version}:{ready:boolean;mode:string;admin:boolean;sessionStatus?:string;version:number}){
 const [data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!ready||mode!=='market'){setData(null);return;}
  const c=new AbortController();let busy=false;
  async function load(){
   if(busy||document.visibilityState==='hidden')return;busy=true;
   try{
    let next=await api('/quotes/intraday?mode=market',{signal:c.signal});
    if(!c.signal.aborted){setData(next);setError('');}
    if(next.configured&&admin&&next.session?.status==='open'&&!next.budget?.paused)next=await api('/admin/quotes/intraday/refresh',{method:'POST',body:'{}',signal:c.signal});
    if(!c.signal.aborted){setData(next);setError('');}
   }catch(e){if(!c.signal.aborted)setError((e as Error).message);}finally{busy=false;}
  }
  void load();const timer=setInterval(load,60000);const visible=()=>{if(document.visibilityState==='visible')void load();};document.addEventListener('visibilitychange',visible);
  return()=>{c.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[ready,mode,admin,sessionStatus,version]);
 return {data,error};
}
// Select by market-event time, never by the time a cache was fetched.
export function latestAvailableQuote(data:any,symbol:string,daily:any,mode='market'){
 const fallback=typeof daily?.price==='number'&&Number.isFinite(daily.price)&&daily.price>0?{...daily,source:mode==='demo'?'demo':'daily',as_of:daily.freshness?.as_of}:null;
 if(mode!=='market')return fallback;
 const candidates=[fallback,...(data?.configured?['delayed_sip','iex'].map(source=>{
  const item=data.feeds?.[source]?.items?.[symbol];return item?{...item,source}:null;
 }):[])].filter(item=>item&&typeof item.price==='number'&&Number.isFinite(item.price)&&item.price>0&&Number.isFinite(Date.parse(item.as_of))&&Date.parse(item.as_of)<=Date.now()+5000);
 // Prefer consolidated data over a single venue when event timestamps tie.
 candidates.sort((a,b)=>Date.parse(b.as_of)-Date.parse(a.as_of)||(a.source==='iex'?1:0)-(b.source==='iex'?1:0));
 return candidates[0]||(fallback&&!Number.isFinite(Date.parse(fallback.as_of))?fallback:null);
}
export default function QuoteInfo({quote,data,error='',symbol}:{quote:any;data?:any;error?:string;symbol:string}){
 const [open,setOpen]=useState(false),[position,setPosition]=useState<any>({});const button=useRef<HTMLButtonElement>(null);const id=useId();
 function show(){const box=button.current?.getBoundingClientRect();if(!box)return;setPosition({left:Math.max(12,Math.min(box.left,window.innerWidth-Math.min(360,window.innerWidth-24)-12)),...(box.bottom+230>window.innerHeight?{bottom:window.innerHeight-box.top+8}:{top:box.bottom+8})});setOpen(true);}
 useEffect(()=>{if(!open)return;const close=()=>setOpen(false);window.addEventListener('scroll',close,true);window.addEventListener('resize',close);return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);};},[open]);
 const source=quote?.source;
 const coverage=source==='iex'?'Latest available trade · limited exchange coverage. This covers one exchange and may differ from the broader market.':source==='delayed_sip'?'Broad-market price · completed minute close, about 15–16 minutes delayed.':source==='demo'?'Synthetic demonstration price · not market data.':quote?.price!=null?'Last completed daily close · a newer intraday quote is not available.':'No cached price is available yet.';
 return <><button ref={button} type="button" className="quote-info" aria-label={`${symbol} price information`} aria-expanded={open} aria-describedby={open?id:undefined} onMouseEnter={show} onMouseLeave={()=>setOpen(false)} onFocus={show} onBlur={()=>setOpen(false)} onClick={event=>{event.stopPropagation();show();}} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);}}}><Info size={14}/></button>{open&&createPortal(<span id={id} role="tooltip" className="quote-info-note" style={position}><b>{symbol} · Price information</b><span>{coverage}</span><span>Price time: {asOf(quote?.as_of)}</span>{(quote?.status==='stale'||quote?.freshness?.stale)&&<span>Older cached price · no newer quote is available.</span>}{data?.session?.status&&data.session.status!=='open'&&<span>Market closed · showing the newest cached price.</span>}{data?.budget?.paused?<span>Updates paused until {asOf(data.budget.resume_at)} to protect the request allowance.</span>:source!=='demo'&&data?.configured&&<span>Checks about once per minute during regular market hours while this view is active.</span>}{error&&<span>Refresh unavailable · cached price retained.</span>}{source!=='demo'&&<span>Daily charts and Buy/Sell reference prices use completed daily bars.</span>}</span>,document.body)}</>;
}
