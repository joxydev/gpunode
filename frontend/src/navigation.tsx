import {createContext,useContext,useEffect,useRef} from 'react';

export const BackContext=createContext<(handler:()=>void)=>()=>void>(()=>()=>{});

export function useAppBack(active:boolean,handler:()=>void){
 const register=useContext(BackContext),current=useRef(handler);
 current.current=handler;
 useEffect(()=>{
  if(!active)return;
  const go=()=>current.current();
  return register(go);
 },[active,register]);
}
