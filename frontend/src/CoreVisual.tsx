import {useEffect,useRef} from 'react';
import {useMotionPreference} from './motion';
import './stellar.css';

/** The artwork never moves. Only the two bounded central light layers change opacity. */
export default function CoreVisual(){
 const scene=useRef<HTMLDivElement>(null),dimmer=useRef<HTMLDivElement>(null),light=useRef<HTMLDivElement>(null);
 const clock=useRef(0);const {paused,toggle}=useMotionPreference();
 useEffect(()=>{
  let frame=0,last=0,paint=0,inView=true;
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  const draw=(time:number)=>{
   if(last)clock.current+=Math.min(time-last,100);last=time;
   // Slow, smooth overlapping waves: no flashes, no random per-frame noise.
   if(time-paint>=32){paint=time;const t=clock.current/1000;
    const breath=(1-Math.cos(t*Math.PI*2/6.8))/2;
    const nuance=(1-Math.cos(t*Math.PI*2/11.3))/2;
    const intensity=.84*breath+.16*nuance;
    if(dimmer.current)dimmer.current.style.opacity=String(preference.matches ? .13+.12*(1-intensity) : .08+.64*(1-intensity));
    if(light.current)light.current.style.opacity=String(preference.matches ? .05+.06*intensity : .02+.3*intensity);
   }
   frame=requestAnimationFrame(draw);
  };
  const resume=()=>{cancelAnimationFrame(frame);last=0;paint=0;if(!paused&&!document.hidden&&inView)frame=requestAnimationFrame(draw)};
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;resume()});
  if(scene.current)observer?.observe(scene.current);
  resume();document.addEventListener('visibilitychange',resume);window.addEventListener('pageshow',resume);preference.addEventListener?.('change',resume);
  return()=>{cancelAnimationFrame(frame);observer?.disconnect();document.removeEventListener('visibilitychange',resume);window.removeEventListener('pageshow',resume);preference.removeEventListener?.('change',resume)};
 },[paused]);
 return <div className="core-visual stellar-visual" onContextMenu={e=>e.preventDefault()}><div className="stellar-scene" ref={scene} role="img" aria-label="Неподвижное нейронное ядро с мягким мерцанием на фоне космического неба"><div className="stellar-sky"/><div className="stellar-dimmer" ref={dimmer}/><div className="stellar-light" ref={light}/></div><span className="core-caption">NEURAL COMPUTE ENGINE</span><button className="motion-toggle" aria-label={paused?'Включить мерцание интерфейса':'Приостановить мерцание интерфейса'} aria-pressed={paused} onClick={toggle}>{paused?'▶ Мерцание':'Ⅱ Пауза'}</button></div>
}
