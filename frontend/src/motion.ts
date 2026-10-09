import {useEffect,useState,type RefObject} from 'react';

function telegramActive(){
 const webApp=window.Telegram?.WebApp;
 return document.visibilityState!=='hidden'&&webApp?.isActive!==false;
}

/** Telegram 8+ exposes isActive and activated/deactivated. Older clients use Page Visibility. */
export function useAppActive(){
 const [active,setActive]=useState(telegramActive);
 useEffect(()=>{
  const webApp=window.Telegram?.WebApp;
  const activate=()=>setActive(document.visibilityState!=='hidden'),deactivate=()=>setActive(false);
  const visibility=()=>setActive(telegramActive());
  webApp?.onEvent?.('activated',activate);webApp?.onEvent?.('deactivated',deactivate);
  window.addEventListener('pageshow',visibility);window.addEventListener('pagehide',deactivate);document.addEventListener('visibilitychange',visibility);
  // A saved pause from the previous implementation must not freeze Telegram WebView.
  try{localStorage.removeItem('aethermind.motion')}catch{}
  return()=>{webApp?.offEvent?.('activated',activate);webApp?.offEvent?.('deactivated',deactivate);window.removeEventListener('pageshow',visibility);window.removeEventListener('pagehide',deactivate);document.removeEventListener('visibilitychange',visibility)};
 },[]);
 return active;
}

export function useAmbientMotion(){
 const active=useAppActive();
 useEffect(()=>{document.documentElement.dataset.ambientMotion=active?'running':'paused';return()=>{delete document.documentElement.dataset.ambientMotion}},[active]);
}

export function useReducedMotion(){
 const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{const query=matchMedia('(prefers-reduced-motion: reduce)'),changed=()=>setReduced(query.matches);query.addEventListener('change',changed);return()=>query.removeEventListener('change',changed)},[]);
 return reduced;
}

type Surface='page'|'detail'|'modal';
function frames(kind:Surface,exit=false):Keyframe[]{
 const mobile=innerWidth<768,transform=kind==='modal'?(mobile?'translateY(18px)':'scale(.98)'):kind==='detail'?'translateX(8px)':'translateY(6px)';
 return exit?[{opacity:1,transform:'none'},{opacity:0,transform:kind==='modal'?(mobile?'translateY(12px)':'scale(.985)'):transform}]:[{opacity:0,transform},{opacity:1,transform:'none'}];
}
export function useSurfaceMotion(ref:RefObject<HTMLElement>,key:unknown,kind:Surface='page'){
 const reduced=useReducedMotion(),active=useAppActive();
 useEffect(()=>{const element=ref.current;if(!element||!active||reduced||!element.animate)return;
  const animation=element.animate(frames(kind),{duration:kind==='modal'?190:kind==='detail'?180:160,easing:'cubic-bezier(.22,1,.36,1)'});
  void animation.finished.catch(()=>{});return()=>animation.cancel();
 },[key,reduced,active,kind,ref]);
}
/** Keep the DOM, inert and focus lock until exit completes. Explicit cancellation never closes a new surface. */
export function exitSurface(element:HTMLElement|null,finish:()=>void){
 let cancelled=false,animation:Animation|null=null,timer:ReturnType<typeof setTimeout>|null=null;
 const done=()=>{if(cancelled)return;cancelled=true;if(timer)clearTimeout(timer);finish();};
 if(!element?.animate||matchMedia('(prefers-reduced-motion: reduce)').matches){queueMicrotask(done);}
 else{animation=element.animate(frames('modal',true),{duration:140,easing:'ease-in',fill:'forwards'});
  void animation.finished.then(done,done);timer=setTimeout(done,260);}
 return()=>{cancelled=true;if(timer)clearTimeout(timer);animation?.cancel();};
}
