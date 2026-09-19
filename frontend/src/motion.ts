import {useEffect,useState} from 'react';
const KEY='aethermind.motion',EVENT='aethermind:motion';
let volatilePause:boolean|undefined;
function readPaused(){if(volatilePause!==undefined)return volatilePause;try{return localStorage.getItem(KEY)==='paused'}catch{return false}}
export function useMotionPreference(){
 const [paused,setPaused]=useState(readPaused);
 useEffect(()=>{const sync=()=>setPaused(readPaused());const storage=(event:StorageEvent)=>{if(event.key===KEY||event.key===null){volatilePause=undefined;sync()}};window.addEventListener(EVENT,sync);window.addEventListener('storage',storage);return()=>{window.removeEventListener(EVENT,sync);window.removeEventListener('storage',storage)}},[]);
 return {paused,toggle(){const value=!readPaused();volatilePause=value;try{localStorage.setItem(KEY,value?'paused':'running')}catch{}window.dispatchEvent(new Event(EVENT))}};
}
export function useAmbientMotion(){
 const {paused}=useMotionPreference();
 useEffect(()=>{const sync=()=>{document.documentElement.dataset.ambientMotion=paused||document.hidden?'paused':'running'};sync();document.addEventListener('visibilitychange',sync);return()=>document.removeEventListener('visibilitychange',sync)},[paused]);
}
