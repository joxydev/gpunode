import {useEffect,useState} from 'react';

function telegramActive(){
 const webApp=window.Telegram?.WebApp;
 if(typeof webApp?.isActive==='boolean')return webApp.isActive;
 return document.visibilityState!=='hidden';
}

/** Telegram 8+ exposes isActive and activated/deactivated. Older clients use Page Visibility. */
export function useAppActive(){
 const [active,setActive]=useState(telegramActive);
 useEffect(()=>{
  const webApp=window.Telegram?.WebApp;
  const activate=()=>setActive(true),deactivate=()=>setActive(false);
  const visibility=()=>{if(typeof webApp?.isActive!=='boolean')setActive(document.visibilityState!=='hidden')};
  webApp?.onEvent?.('activated',activate);webApp?.onEvent?.('deactivated',deactivate);
  window.addEventListener('pageshow',activate);window.addEventListener('pagehide',deactivate);document.addEventListener('visibilitychange',visibility);
  // A saved pause from the previous implementation must not freeze Telegram WebView.
  try{localStorage.removeItem('aethermind.motion')}catch{}
  return()=>{webApp?.offEvent?.('activated',activate);webApp?.offEvent?.('deactivated',deactivate);window.removeEventListener('pageshow',activate);window.removeEventListener('pagehide',deactivate);document.removeEventListener('visibilitychange',visibility)};
 },[]);
 return active;
}

export function useAmbientMotion(){
 const active=useAppActive();
 useEffect(()=>{document.documentElement.dataset.ambientMotion=active?'running':'paused';return()=>{delete document.documentElement.dataset.ambientMotion}},[active]);
}
