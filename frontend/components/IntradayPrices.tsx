'use client';
import {useEffect,useState} from 'react';
import {Clock,Radio} from 'lucide-react';
import {api,money,asOf} from '@/lib/api';
export function useIntradayPrices({ready,mode,admin,sessionStatus,version}:{ready:boolean;mode:string;admin:boolean;sessionStatus?:string;version:number}){
 const [data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!ready||mode!=='market'){setData(null);return;}
  const c=new AbortController();let busy=false;
  async function load(){
   if(busy||document.visibilityState==='hidden')return;busy=true;
   try{
    let next=await api('/quotes/intraday?mode=market',{signal:c.signal});
    if(next.configured&&admin&&next.session?.status==='open'&&!next.budget?.paused)next=await api('/admin/quotes/intraday/refresh',{method:'POST',body:'{}',signal:c.signal});
    if(!c.signal.aborted){setData(next);setError('');}
   }catch(e){if(!c.signal.aborted)setError((e as Error).message);}finally{busy=false;}
  }
  void load();const timer=setInterval(load,60000);const visible=()=>{if(document.visibilityState==='visible')void load();};document.addEventListener('visibilitychange',visible);
  return()=>{c.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[ready,mode,admin,sessionStatus,version]);
 return {data,error};
}
export default function IntradayPrices({data,error,symbol,selected,onSelect}:{data:any;error:string;symbol:string;selected:string;onSelect:(feed:string)=>void}){
 const feeds=[['delayed_sip','Broad market','15–16m delayed'],['iex','IEX latest','Limited exchange coverage']];
 return <section className="intraday-prices" aria-label="Intraday price feeds"><div className="intraday-heading"><span><Radio size={14}/>Price views</span><small>{data?.configured?data.session?.status==='open'?'Checks every 60 seconds while this view is active':'Market closed · cached prices':'Intraday refresh disabled'}</small></div><div role="tablist" aria-label="Price feed">{feeds.map(([id,label,coverage])=>{const source=data?.feeds?.[id],item=source?.items?.[symbol];return <button role="tab" aria-selected={selected===id} key={id} className={selected===id?'selected':''} onClick={()=>onSelect(id)}><span><b>{label}</b><small>{coverage}</small></span><strong>{money(item?.price)}</strong><small><Clock size={11}/>{item?.as_of?asOf(item.as_of):source?.status==='waiting_for_delayed_session'?'Waiting for delayed session prices':'No cached intraday price'}</small>{item?.status==='stale'&&<em>Stale trade timestamp</em>}</button>;})}</div>{error&&<p className="notice" role="status">{error} · cached prices retained.</p>}{data?.budget?.paused&&<p className="notice">Price updates paused until {asOf(data.budget.resume_at)} to protect the request allowance.</p>}<p className="intraday-note">{data?.configured?'Daily charts and Buy/Sell reference prices remain based on completed daily bars. Change uses the prior consolidated session close when available.':'The daily close remains available. Automatic intraday access must be enabled on the backend.'}</p></section>;
}
