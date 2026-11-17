'use client';
import {useEffect,useRef,useState} from 'react';
import {createChart,CandlestickSeries,LineSeries,AreaSeries,HistogramSeries,ColorType,LineStyle,type Time,type IChartApi} from 'lightweight-charts';
import type {Bar,Signal,IndicatorConfig} from '@/lib/api';
import {money} from '@/lib/api';
type Badge={key:string;x:number;y:number;anchorX:number;anchorY:number;width:number;signal:Signal};
type Props={bars:Bar[];indicators:Record<string,(number|null)[]>;signals:Signal[];type:string;dark:boolean;config:IndicatorConfig;onSignal:(signal:Signal)=>void};
export default function MarketChart({bars,indicators,signals,type,dark,config,onSignal}:Props){
 const container=useRef<HTMLDivElement>(null);const chartRef=useRef<IChartApi|null>(null);
 const [badges,setBadges]=useState<Badge[]>([]);
 const [hiddenBadges,setHiddenBadges]=useState(0);
 const [hover,setHover]=useState<{date:string;close:number;open:number;high:number;low:number}|null>(null);
 useEffect(()=>{
  setBadges([]);setHiddenBadges(0);
  if(!container.current||!bars.length)return;
  const text=dark?'#a7b6c9':'#78838a',grid=dark?'#233247':'#f0f2f1';
  const chart=createChart(container.current,{autoSize:true,height:config.rsi||config.macd||config.atr||config.rvol?490:430,layout:{background:{type:ColorType.Solid,color:dark?'#131f30':'#ffffff'},textColor:text,fontFamily:'IBM Plex Mono',fontSize:10,attributionLogo:true,panes:{separatorColor:grid,separatorHoverColor:'#8eaa9d',enableResize:true}},grid:{vertLines:{color:grid},horzLines:{color:grid}},rightPriceScale:{borderVisible:false},timeScale:{borderVisible:false,timeVisible:false,rightOffset:5},crosshair:{vertLine:{labelBackgroundColor:'#254e40'},horzLine:{labelBackgroundColor:'#254e40'}},handleScroll:true,handleScale:true});
  chartRef.current=chart;
  const time=(b:Bar)=>b.timestamp.slice(0,10) as Time;
  const series= type==='candlestick'?chart.addSeries(CandlestickSeries,{upColor:'#3d806b',downColor:'#bc776b',borderVisible:false,wickUpColor:'#3d806b',wickDownColor:'#bc776b'}):type==='area'?chart.addSeries(AreaSeries,{lineColor:'#377d65',topColor:'rgba(55,125,101,.18)',bottomColor:'rgba(55,125,101,0)',lineWidth:2}):chart.addSeries(LineSeries,{color:'#377d65',lineWidth:2});
  if(type==='candlestick')series.setData(bars.map(b=>({time:time(b),open:b.open,high:b.high,low:b.low,close:b.close})));
  else series.setData(bars.map(b=>({time:time(b),value:b.close})));
  series.priceScale().applyOptions({scaleMargins:{top:.10,bottom:.24}});
  const volume=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});
  volume.setData(bars.map(b=>({time:time(b),value:b.volume,color:b.close>=b.open?'rgba(61,128,107,.24)':'rgba(188,119,107,.22)'})));
  volume.priceScale().applyOptions({scaleMargins:{top:.84,bottom:0}});
  const colors=['#b28a51','#7e87af','#5f9eaf','#b486a7','#c4956e','#7b9284'];let n=0;let pane=1;
  const data=(values:(number|null)[])=>values.flatMap((v,i)=>v==null?[]:[{time:time(bars[i]),value:v}]);
  for(const [key,values] of Object.entries(indicators)){
   if(key.startsWith('sma')||key.startsWith('ema')||key.startsWith('bb')){
    const overlay=chart.addSeries(LineSeries,{color:key.startsWith('bb')?'#a1aaa2':colors[n++%colors.length],lineWidth:1,lineStyle:key.startsWith('bb')?LineStyle.Dashed:LineStyle.Solid,lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false});overlay.setData(data(values));
   }
  }
  function addPane(key:string,color:string,label:string,histogram=false){
   const s=histogram?chart.addSeries(HistogramSeries,{color,lastValueVisible:false,priceLineVisible:false,title:label},pane):chart.addSeries(LineSeries,{color,lineWidth:1,lastValueVisible:false,priceLineVisible:false,title:label},pane);
   s.setData(data(indicators[key]));return s;
  }
  if(indicators.rsi){const r=addPane('rsi','#7e87af',`RSI ${config.rsi_period}`);for(const p of [config.rsi_lower,config.rsi_upper])r.createPriceLine({price:p,color:'#a6adb2',lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true});chart.panes()[pane].setHeight(90);pane++;}
  if(indicators.macd){addPane('macd_histogram','#8eaa9d','MACD histogram',true);addPane('macd','#7e87af','MACD');addPane('macd_signal','#b28a51','Signal');chart.panes()[pane].setHeight(85);pane++;}
  if(indicators.atr){addPane('atr','#b28a51',`ATR ${config.atr_period}`);chart.panes()[pane].setHeight(75);pane++;}
  if(indicators.rvol){const rv=addPane('rvol','#5f9eaf',`Relative volume ${config.rvol_period}`);rv.createPriceLine({price:1,color:'#a6adb2',lineWidth:1,lineStyle:LineStyle.Dashed});chart.panes()[pane].setHeight(75);}
  const dates=new Set(bars.map(b=>b.timestamp.slice(0,10)));
  // Price-anchored HTML badges are the only chart candidate decoration.
  let disposed=false;
  const updateBadges=()=>{
   if(disposed||!container.current||!chart.panes()[0])return;
   const grouped=new Map<string,Signal>();
   for(const s of signals)if(dates.has(s.time.slice(0,10)))grouped.set(s.time.slice(0,10)+'-'+s.kind,s);
   const labels:Badge[]=[];
   const plotWidth=(container.current.clientWidth||0)-chart.priceScale('right').width();
   const paneHeight=chart.panes()[0].getHeight();let hidden=0;
   const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(v,hi));
   const collides=(x:number,y:number,width:number)=>labels.some(b=>Math.abs(b.x-x)<(b.width+width)/2+5&&Math.abs(b.y-y)<31);
   for(const [key,s] of grouped){
    const x=chart.timeScale().timeToCoordinate(s.time.slice(0,10) as Time), y=series.priceToCoordinate(s.price);
    if(x===null||y===null||x<0||x>plotWidth||y<0||y>paneHeight)continue;
    const width=Math.max(98,Math.min(150,58+money(s.price).length*6));
    if(plotWidth<width+12){hidden++;continue;}
    const direction=s.kind==='entry'?1:-1;
    const baseY=clamp(Number(y)+direction*26,16,paneHeight-16);
    const baseX=clamp(Number(x),width/2+6,plotWidth-width/2-6);
    let placement:{x:number;y:number}|null=null;
    // Keep labels near their source candle, separating clusters at wide ranges.
    for(let row=0;row<Math.ceil(paneHeight/32)&&!placement;row++){
     for(const vertical of row===0?[0]:[direction*row*32,-direction*row*32]){
      const py=baseY+vertical;if(py<16||py>paneHeight-16)continue;
      for(const horizontal of [0,-28,28,-56,56]){
       const px=clamp(baseX+horizontal,width/2+6,plotWidth-width/2-6);
       if(!collides(px,py,width)){placement={x:px,y:py};break;}
      }
      if(placement)break;
     }
    }
    if(placement)labels.push({key,...placement,anchorX:Number(x),anchorY:Number(y),width,signal:s});
    else hidden++;

   }
   setBadges(labels);setHiddenBadges(hidden);
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(updateBadges);
  const resize=new ResizeObserver(()=>requestAnimationFrame(updateBadges));resize.observe(container.current!);
  chart.subscribeCrosshairMove(updateBadges);
  chart.subscribeClick(p=>{if(!p.time)return;const date=typeof p.time==='string'?p.time:typeof p.time==='number'?new Date(p.time*1000).toISOString().slice(0,10):`${p.time.year}-${String(p.time.month).padStart(2,'0')}-${String(p.time.day).padStart(2,'0')}`;const event=signals.find(s=>s.time.startsWith(date));if(event)onSignal(event);});
  chart.subscribeCrosshairMove(p=>{if(!p.time){setHover(null);return;}const b=bars.find(b=>time(b)===p.time);if(b)setHover({date:b.timestamp.slice(0,10),close:b.close,open:b.open,high:b.high,low:b.low});});
  chart.timeScale().fitContent();requestAnimationFrame(updateBadges);
  return ()=>{disposed=true;resize.disconnect();chartRef.current=null;chart.remove();};
 },[bars,indicators,signals,type,dark,config,onSignal]);
 return <div className="chart-wrap" style={{position:'relative'}}><div className="chart-readout" aria-live="off">{hover?<><span>{hover.date}</span><span>O {money(hover.open)}</span><span>H {money(hover.high)}</span><span>L {money(hover.low)}</span><span>C {money(hover.close)}</span></>:<><span>Daily OHLCV</span><span>Drag to explore · Scroll to zoom · Click a candidate candle</span></>}</div><div className="chart-badges" style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:3,overflow:'hidden'}} aria-label="Historical research candidate badges"><svg className="chart-badge-connectors" aria-hidden="true" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>{badges.map(b=><g key={b.key}><line x1={b.anchorX} y1={b.anchorY+27} x2={b.x} y2={b.y+27} stroke={b.signal.kind==='entry'?'#2c705b':'#ad7465'} strokeWidth="1" opacity=".45"/><circle cx={b.anchorX} cy={b.anchorY+27} r="2.5" fill={b.signal.kind==='entry'?'#2c705b':'#ad7465'}/></g>)}</svg>{badges.map(({key,x,y,width,signal})=><button key={key} className={`chart-candidate-badge ${signal.kind}`} style={{position:'absolute',left:x,top:y+27,width,height:27,justifyContent:'center',transform:'translate(-50%,-50%)',pointerEvents:'auto',display:'inline-flex',alignItems:'center',gap:5,padding:'5px 7px',borderRadius:5,border:`1px solid ${signal.kind==='entry'?'#2c705b':'#ad7465'}`,background:signal.kind==='entry'?'#e7f6ec':'#fff0ed',color:signal.kind==='entry'?'#1e6843':'#a53c30',fontSize:11,lineHeight:1.2,whiteSpace:'nowrap'}} onClick={()=>onSignal(signal)} title={`${signal.kind==='entry'?'Buy':'Sell'} candidate · ${signal.time.slice(0,10)} · ${signal.strategy} · source-bar close, not an executable quote · research only`} aria-label={`${signal.kind==='entry'?'Buy':'Sell'} candidate ${signal.time.slice(0,10)}; show evidence`}><span>{signal.kind==='entry'?'▲':'▼'}</span>{signal.kind==='entry'?'Buy':'Sell'}<b>{money(signal.price)}</b></button>)}</div><div ref={container} className="chart-canvas" role="img" aria-label="Interactive daily price chart with volume, indicators, and historical research candidate markers"/>{hiddenBadges>0&&<p className="chart-label-note" role="status">{hiddenBadges} more candidates at this zoom. Zoom in or click a candidate candle to inspect.</p>}<a className="chart-credit" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Charts by TradingView Lightweight Charts™</a></div>;
}
