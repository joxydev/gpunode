import {useLanguage} from './i18n';
import {useEffect,useRef} from 'react';
import {useAppActive} from './motion';
import './stellar.css';

const CYCLE_MS=4400;

/** The source artwork never moves. Three bounded overlays animate only the central star. */
export default function CoreVisual(){
 const {t}=useLanguage();
 const dimmer=useRef<HTMLDivElement>(null),light=useRef<HTMLDivElement>(null),flare=useRef<HTMLDivElement>(null);
 const active=useAppActive();
 useEffect(()=>{
  let frame=0,lastFrame=performance.now(),phase=0,previous=lastFrame;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const paint=(time:number)=>{
   const delta=Math.min(Math.max(time-previous,0),100);previous=time;phase=(phase+delta)%CYCLE_MS;
   // Smoothstep makes the star linger at both ends instead of flashing.
   const raw=(1-Math.cos(phase/CYCLE_MS*Math.PI*2))/2;
   const pulse=raw*raw*(3-2*raw);
   const range=reduced.matches ? .38 : .88;
   const value=(1-range)/2+range*pulse;
   if(dimmer.current)dimmer.current.style.opacity=String(.9-.82*value);
   if(light.current)light.current.style.opacity=String(.08+.7*value);
   if(flare.current)flare.current.style.opacity=String(.04+.46*value);
   lastFrame=time;
  };
  const loop=(time:number)=>{paint(time);frame=requestAnimationFrame(loop)};
  if(active){previous=performance.now();frame=requestAnimationFrame(loop)}
  // Native Telegram sheets may delay rAF. This paints only after a foreground stall.
  const watchdog=window.setInterval(()=>{const now=performance.now();if(active&&now-lastFrame>300)paint(now)},250);
  const changed=()=>{previous=performance.now()};reduced.addEventListener?.('change',changed);
  return()=>{cancelAnimationFrame(frame);clearInterval(watchdog);reduced.removeEventListener?.('change',changed)};
 },[active]);
 return <div className="core-visual stellar-visual" onContextMenu={e=>e.preventDefault()}><div className="stellar-scene" role="img" aria-label={t("Неподвижная нейронная звезда мягко мерцает на фоне космического неба")}><div className="stellar-sky"/><div className="stellar-dimmer" ref={dimmer}/><div className="stellar-light" ref={light}/><div className="stellar-flare" ref={flare}/></div><span className="core-caption"><i/> LIVE NEURAL CORE</span></div>
}
