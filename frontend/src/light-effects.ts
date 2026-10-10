import {useEffect} from 'react';
import './light-effects.css';

type Connection=EventTarget&{saveData?:boolean};
type Kind='card'|'art'|'button'|'nav'|'core';
const selector='.fx-card, .fx-art, .primary, .app-nav button.active, .stellar-scene';
const costs:Record<Kind,number>={card:4,art:2,button:1,nav:1,core:3};
const kinds:Kind[]=['core','card','art','button','nav'];
function kind(element:HTMLElement):Kind{
 if(element.classList.contains('stellar-scene'))return 'core';
 if(element.classList.contains('fx-card'))return 'card';
 if(element.classList.contains('fx-art'))return 'art';
 return element.classList.contains('primary')?'button':'nav';
}

/** Event-driven allocation: one observer, a bounded layer budget, no render loop. */
export function installLightEffects(){
 const root=document.documentElement,query=matchMedia('(prefers-reduced-motion: reduce)');
 const connection=(navigator as Navigator&{connection?:Connection;deviceMemory?:number}).connection;
 const memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory;
 const budget=navigator.hardwareConcurrency<=4||(memory!==undefined&&memory<=4)?7:14;
 const webApp=window.Telegram?.WebApp;
 let foreground=document.visibilityState!=='hidden'&&webApp?.isActive!==false,queued=0;
 const tracked=new Set<HTMLElement>(),visible=new Set<HTMLElement>(),running=new Set<HTMLElement>();
 root.dataset.lightFxBudget=String(budget);
 const observer='IntersectionObserver' in window?new IntersectionObserver(entries=>{
  for(const entry of entries){const element=entry.target as HTMLElement;if(entry.isIntersecting&&entry.intersectionRatio>0)visible.add(element);else visible.delete(element);}
  schedule();
 // Edge-adjacent rectangles may intersect with zero area. Observe a positive
 // threshold too, so moving a few pixels into view reliably starts the effect.
 },{threshold:[0,.01]}):null;
 function allocate(){
  queued=0;
  const policy=query.matches?'reduced':connection?.saveData?'save-data':!foreground||document.visibilityState==='hidden'?'suspended':!observer?'static':budget===7?'limited':'running';
  root.dataset.lightFx=policy;
  const next=new Set<HTMLElement>();
  if(policy==='running'||policy==='limited'){
   // A modal consumes the budget itself. Background cards and navigation stay still.
   const modal=Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [aria-modal="true"]')).filter(el=>el.getClientRects().length).at(-1);
   const groups=new Map(kinds.map(k=>[k,[] as HTMLElement[]]));
   for(const element of visible){
    if(!tracked.has(element)||element.dataset.fxEnabled==='false'||element.matches(':disabled, [aria-disabled="true"]')||!element.getClientRects().length||modal&&!modal.contains(element))continue;
    groups.get(kind(element))!.push(element);
   }
   const distance=(el:HTMLElement)=>{const rect=el.getBoundingClientRect();return Math.abs((rect.top+rect.bottom)/2-innerHeight/2)};
   for(const group of groups.values())group.sort((a,b)=>distance(a)-distance(b));
   let remaining=budget;
   // Round-robin keeps a frame, artwork and a button available together on mobile.
   for(let index=0;index<budget;index++)for(const k of kinds){const element=groups.get(k)![index];if(element&&costs[k]<=remaining){next.add(element);remaining-=costs[k];}}
  }
  for(const element of running)if(!next.has(element)){delete element.dataset.fxRun;running.delete(element);}
  for(const element of next)if(!running.has(element)){element.dataset.fxRun='running';running.add(element);}
 }
 function schedule(){if(!queued)queued=requestAnimationFrame(allocate);}
 function refresh(){
  const found=new Set(document.querySelectorAll<HTMLElement>(selector));
  for(const element of tracked)if(!found.has(element)){observer?.unobserve(element);tracked.delete(element);visible.delete(element);delete element.dataset.fxRun;running.delete(element);}
  for(const element of found)if(!tracked.has(element)){tracked.add(element);observer?.observe(element);}
  schedule();
 }
 const mutations=new MutationObserver(refresh);
 mutations.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','disabled','aria-disabled','data-fx-enabled','open','hidden','aria-modal']});
 const activate=()=>{foreground=true;schedule();};
 // Synchronous removal also works when a hidden WebView stops requestAnimationFrame.
 const suspend=()=>{foreground=false;if(queued)cancelAnimationFrame(queued);queued=0;allocate();};
 const visibility=()=>{if(document.visibilityState==='hidden'||webApp?.isActive===false)suspend();else activate();};
 query.addEventListener('change',schedule);connection?.addEventListener('change',schedule);
 document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',suspend);window.addEventListener('pageshow',visibility);
 webApp?.onEvent?.('activated',activate);webApp?.onEvent?.('deactivated',suspend);
 refresh();
 return()=>{
  observer?.disconnect();mutations.disconnect();if(queued)cancelAnimationFrame(queued);
  query.removeEventListener('change',schedule);connection?.removeEventListener('change',schedule);
  document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',suspend);window.removeEventListener('pageshow',visibility);
  webApp?.offEvent?.('activated',activate);webApp?.offEvent?.('deactivated',suspend);
  for(const element of running)delete element.dataset.fxRun;
  delete root.dataset.lightFx;delete root.dataset.lightFxBudget;
 };
}
export function useLightEffects(){useEffect(installLightEffects,[])}
