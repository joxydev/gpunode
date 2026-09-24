import {browserLanguage} from './i18n';
import {translations} from './translations';
declare global {interface Window{Telegram?:{WebApp:{initData:string;isExpanded?:boolean;isActive?:boolean;platform?:string;version?:string;ready:()=>void;expand:()=>void;onEvent?:(event:string,callback:()=>void)=>void;offEvent?:(event:string,callback:()=>void)=>void;setHeaderColor?:(s:string)=>void;setBackgroundColor?:(s:string)=>void;HapticFeedback?:{impactOccurred:(s:string)=>void};openTelegramLink?:(s:string)=>void}}}}
let token='';export const setToken=(v:string)=>{token=v;try{if(v)sessionStorage.setItem('aethermind.session',v);else sessionStorage.removeItem('aethermind.session');}catch{}};
export function savedToken(){try{return sessionStorage.getItem('aethermind.session')||'';}catch{return '';}}
export async function api<T=any>(path:string,body?:unknown,method=body?'POST':'GET'):Promise<T>{
  let response:Response;
  try{response=await fetch('/api'+path,{method,signal:AbortSignal.timeout(15000),headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined})}
  catch{const language=browserLanguage()||'ru';throw Error(language==='en'?'Cannot connect to the server. Try again.':language==='ro'?'Nu ne putem conecta la server. Încearcă din nou.':'Нет связи с сервером. Повторите попытку.')}
  const data=await response.json();if(!response.ok){
    const language=browserLanguage()||'ru';
    const original=typeof data.message==='string'?data.message:'Запрос не выполнен.';
    const field=original.match(/^Проверьте поле ([a-zA-Z]+)\.$/);
    const translated=language==='ru'?original:field?(language==='en'?`Check the ${field[1]} field.`:`Verifică câmpul ${field[1]}.`):translations[original]?.[language==='en'?0:1]||( /[А-Яа-яЁё]/.test(original)?translations['Запрос не выполнен.'][language==='en'?0:1]:original);
    throw Error(translated);
  }return data;
}
export function haptic(){try{window.Telegram?.WebApp.HapticFeedback?.impactOccurred('light');}catch{/* unsupported client */}}
export type NodeSpec={id:string;name:string;label:string;memory:string|null;compute:string|null;use:string;image:string;status:string;price:null};
export type RequestItem={id:string;nodeId:string;profile:string;workload:string;paymentStatus:'WAITING'|'PAID';userUnread:boolean;status:string;decision?:string|null;closureReason?:string|null;closedAt?:string|null;createdAt:string;updatedAt:string;equipment?:{id:string;name:string};user?:{id:string;name:string;username?:string|null}};
export type TicketMessage={id:string;authorType:'USER'|'OWNER';authorId?:string;body:string;createdAt:string};
export type Ticket={id:string;category:'QUESTION'|'COMPLAINT';subject:string;status:'OPEN'|'IN_PROGRESS'|'ANSWERED'|'CLOSED';ownerUnread?:boolean;userUnread:boolean;lastMessageAt:string;createdAt:string;updatedAt:string;messages:TicketMessage[];_count?:{messages:number};user?:{id:string;name:string;username?:string|null}};
export type OfferTariff={nodeId:string;id:string;name:string;depositUsdt:string;days:number;dailyPercent:string|null;dailyUsdt:string|null;compoundPercent:string|null;termPercent:string|null;termYieldUsdt:string|null;available:boolean;selectedAt?:string|null};
export type JourneyStep={id:'REGISTERED'|'TARIFF'|'FUNDED'|'ORDERED'|'WITHDRAW';title:string;description:string;state:'DONE'|'CURRENT'|'WAITING'|'LOCKED';available:boolean};
export type ReferralItem={id:string;label:string;stage:'REGISTERED'|'OFFER_ACCEPTED'|'TARIFF_SELECTED'|'ACTIVE';joinedAt:string};
export type Account={user:{id:string;name:string;username?:string|null;isOwner:boolean;preferredLanguage?:'ru'|'en'|'ro'|null};agreement:{version:string;accepted:boolean;acceptedAt:string|null};offer:{number:string;version:string;documentSha256:string;accepted:boolean;acceptedAt:string|null};balance:string;earnedToday:null;selectedTariff:OfferTariff|null;journey:JourneyStep[];activeNodes:{id:string;status:string;createdAt:string;expiresAt:string;node:{name:string}}[];requests:RequestItem[];tickets:Ticket[];notifications:{unreadSupport:number;unreadOrders:number};referrals:{total:number;active:number;rewardConfigured:boolean;items:ReferralItem[]};entries:{id:string;amount:string;kind:string;createdAt:string}[];paymentsEnabled:boolean;accrualEnabled:boolean;updatedAt:string};
