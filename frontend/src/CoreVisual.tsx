import {useLanguage} from './i18n';
import {useEffect,useRef} from 'react';
import {useAppActive} from './motion';
import './stellar.css';

const CYCLE_MS=4400;

/** The source artwork never moves. Three bounded overlays animate only the central star. */
export default function CoreVisual({activeView=true}:{activeView?:boolean}){
 const {t}=useLanguage();
 const dimmer=useRef<HTMLDivElement>(null),light=useRef<HTMLDivElement>(null),flare=useRef<HTMLDivElement>(null);
 const foreground=useAppActive(),active=foreground&&activeView;
 useEffect(()=>{
  let frame=0,phase=0,previous=performance.now();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const paint=(value:number)=>{
   if(dimmer.current)dimmer.current.style.opacity=String(.9-.82*value);
   if(light.current)light.current.style.opacity=String(.08+.7*value);
   if(flare.current)flare.current.style.opacity=String(.04+.46*value);
  };
  const loop=(time:number)=>{const delta=Math.min(Math.max(time-previous,0),100);previous=time;phase=(phase+delta)%CYCLE_MS;const raw=(1-Math.cos(phase/CYCLE_MS*Math.PI*2))/2;paint(.06+.88*raw*raw*(3-2*raw));frame=requestAnimationFrame(loop)};
  const changed=()=>{cancelAnimationFrame(frame);frame=0;paint(.4);if(active&&!reduced.matches){previous=performance.now();frame=requestAnimationFrame(loop)}};
  changed();reduced.addEventListener('change',changed);
  return()=>{cancelAnimationFrame(frame);reduced.removeEventListener('change',changed)};
 },[active]);
 return <div className="core-visual stellar-visual" onContextMenu={e=>e.preventDefault()}><div className="stellar-scene" role="img" aria-label={t("Неподвижная нейронная звезда мягко мерцает на фоне космического неба")}><div className="stellar-sky"/><div className="stellar-dimmer" ref={dimmer}/><div className="stellar-light" ref={light}/><div className="stellar-flare" ref={flare}/></div><span className="core-caption"><i/> LIVE NEURAL CORE</span></div>
}
