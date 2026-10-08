import {useEffect} from 'react';

/** Focus alone does not imply an open keyboard (hardware keyboards and desktop). */
export function keyboardVisible(focused:boolean,stableHeight:number,visibleHeight:number){
 return focused&&stableHeight-visibleHeight>Math.min(140,stableHeight*.22);
}
export function useViewport(){
 useEffect(()=>{
  const root=document.documentElement,tg=window.Telegram?.WebApp,viewport=window.visualViewport;
  let baseline=window.innerHeight,width=window.innerWidth;
  const update=()=>{
   const focused=Boolean(document.activeElement?.matches('input:not([type=checkbox]):not([type=radio]),textarea,select'));
   if(Math.abs(window.innerWidth-width)>80){width=window.innerWidth;baseline=window.innerHeight}
   if(!focused)baseline=window.innerHeight;
   const stable=Math.max(baseline,tg?.viewportStableHeight||0);
   const visible=Math.min(viewport?.height||window.innerHeight,tg?.viewportHeight||window.innerHeight);
   const open=keyboardVisible(focused,stable,visible);
   root.style.setProperty('--app-viewport-height',visible+'px');
   root.classList.toggle('app-keyboard-open',open);
   if(open&&(document.activeElement instanceof HTMLElement))document.activeElement.scrollIntoView({block:'nearest'});
  };
  update();viewport?.addEventListener('resize',update);window.addEventListener('resize',update);
  document.addEventListener('focusin',update);document.addEventListener('focusout',update);
  tg?.onEvent?.('viewportChanged',update);
  return()=>{viewport?.removeEventListener('resize',update);window.removeEventListener('resize',update);document.removeEventListener('focusin',update);document.removeEventListener('focusout',update);tg?.offEvent?.('viewportChanged',update);root.classList.remove('app-keyboard-open')};
 },[]);
}
