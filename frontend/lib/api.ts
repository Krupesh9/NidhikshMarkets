let csrf='';
let redirecting=false;
export function setCsrf(value:string){csrf=value;}
export async function api<T=any>(path:string,init:RequestInit={}):Promise<T>{
 const res=await fetch(`/api${path}`,{...init,headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{}),...init.headers},cache:'no-store'});
 const data=await res.json();
 if(!res.ok){if(res.status===401&&!path.includes('/auth/login')&&!redirecting&&window.location.pathname!=='/login'){redirecting=true;window.location.replace('/login');}throw new Error(typeof data.detail==='string'?data.detail:`Request failed (${res.status})`);}
 return data;
}
export function money(value:number|null|undefined){return value==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);}
export function number(value:number|null|undefined){return value==null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(value);}
export function asOf(value:string|null|undefined){if(!value)return 'Not available';const d=new Date(value);return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'}).format(d);}
export type IndicatorConfig={sma:number[];ema:number[];rsi:boolean;rsi_period:number;rsi_lower:number;rsi_upper:number;bb:boolean;bb_period:number;bb_std:number;macd:boolean;macd_fast:number;macd_slow:number;macd_signal:number;atr:boolean;atr_period:number;rvol:boolean;rvol_period:number};
export type Signal={strategy:string;kind:string;time:string;price:number;evidence:Record<string,any>;parameters:Record<string,number>;version:string;source_bar:Record<string,number|string>;provenance:Record<string,any>;label:string;evaluated_at?:string};
export type Bar={timestamp:string;open:number;high:number;low:number;close:number;volume:number;provenance:Record<string,any>};
