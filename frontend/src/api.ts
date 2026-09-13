declare global {interface Window{Telegram?:{WebApp:{initData:string;ready:()=>void;expand:()=>void;setHeaderColor?:(s:string)=>void;setBackgroundColor?:(s:string)=>void;HapticFeedback?:{impactOccurred:(s:string)=>void};openTelegramLink?:(s:string)=>void}}}}
let token='';export const setToken=(v:string)=>{token=v;};
export async function api<T=any>(path:string,body?:unknown,method=body?'POST':'GET'):Promise<T>{
  const response=await fetch('/api'+path,{method,signal:AbortSignal.timeout(15000),headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok)throw Error(data.message||'Запрос не выполнен.');return data;
}
export function haptic(){try{window.Telegram?.WebApp.HapticFeedback?.impactOccurred('light');}catch{/* unsupported client */}}
export type NodeSpec={id:string;name:string;label:string;memory:string|null;compute:string|null;use:string;image:string;status:string;price:null};
export type RequestItem={id:string;nodeId:string;profile:string;workload:string;status:string;createdAt:string;user?:{name:string}};
export type Ticket={id:string;message:string;reply:string|null;user?:{name:string}};
export type Account={user:{id:string;name:string;isOwner:boolean};balance:string;earnedToday:null;activeNodes:unknown[];requests:RequestItem[];tickets:Ticket[];referrals:number;entries:{id:string;amount:string;kind:string;createdAt:string}[];updatedAt:string};
