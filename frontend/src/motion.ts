import {useEffect,useState} from 'react';

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
