import {useEffect,useRef,useState} from 'react';
export default function CoreVisual(){
 const art=useRef<HTMLDivElement>(null),glow=useRef<HTMLDivElement>(null);
 const [paused,setPaused]=useState(()=>{try{return localStorage.getItem('aethermind.motion')==='paused'}catch{return false}});
 useEffect(()=>{
  let frame=0;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw=(time:number)=>{const wave=(1-Math.cos(time/3200*Math.PI*2))/2;
   if(art.current)art.current.style.transform=`translate3d(0,${reduced?0:4-10*wave}px,0) scale(${(reduced ? .98 : .92) + (reduced ? .04 : .16) * wave})`;
   if(glow.current){glow.current.style.opacity=String(.2+.55*wave);glow.current.style.transform=`scale(${.85+.25*wave})`;}
   frame=requestAnimationFrame(draw);
  };
  const resume=()=>{cancelAnimationFrame(frame);if(!paused&&!document.hidden)frame=requestAnimationFrame(draw)};
  resume();document.addEventListener('visibilitychange',resume);window.addEventListener('pageshow',resume);
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',resume);window.removeEventListener('pageshow',resume)};
 },[paused]);
 return <div className="core-visual" onContextMenu={e=>e.preventDefault()}><div ref={glow} className="core-light" aria-hidden="true"/><div ref={art} className="core-image" role="img" aria-label="Нейронное ядро AetherMind"/><span className="core-caption">NEURAL COMPUTE ENGINE</span><button className="motion-toggle" aria-pressed={paused} onClick={()=>{setPaused(!paused);try{localStorage.setItem('aethermind.motion',paused?'running':'paused')}catch{}}}>{paused?'▶ Анимация':'Ⅱ Пауза'}</button></div>
}
