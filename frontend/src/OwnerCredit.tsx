import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {useLanguage,intlLocale} from './i18n';
import {useSurfaceMotion} from './motion';
import {exactMoney,normalizeCreditAmount} from './exact-money';

type Credit={id:string;userId:string;actorId:string;amount:string;reason:string;balanceAfter:string;createdAt:string};
type Draft={amount:string;reason:string;idempotencyKey:string};
type Props={ownerId:string;user:{id:string;name:string;username?:string|null};balance:string;onBusy:(busy:boolean)=>void;onCredited:()=>Promise<void>};
export default function OwnerCredit({ownerId,user,balance,onBusy,onCredited}:Props){
 const {t,language}=useLanguage(),locale=intlLocale(language),storageKey='aethermind.owner-credit.pending:'+ownerId+':'+user.id;
 const restored=useRef<Draft|null>(null),initialized=useRef(false);
 if(!initialized.current){initialized.current=true;try{const draft=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(draft&&normalizeCreditAmount(draft.amount)&&typeof draft.reason==='string'&&typeof draft.idempotencyKey==='string')restored.current=draft}catch{}}
 const [open,setOpen]=useState(Boolean(restored.current)),[amount,setAmount]=useState(restored.current?.amount||''),[reason,setReason]=useState(restored.current?.reason||''),[review,setReview]=useState(Boolean(restored.current)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<Credit|null>(null),[history,setHistory]=useState<Credit[]>([]);
 const surface=useRef<HTMLElement>(null);useSurfaceMotion(surface,open+':'+review+':'+Boolean(receipt));
 const request=useRef<Draft|null>(restored.current),sending=useRef(false);
 const normalized=normalizeCreditAmount(amount),normalizedReason=reason.trim().replace(/\s+/g,' '),valid=Boolean(normalized)&&normalizedReason.length>=3&&normalizedReason.length<=500&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(reason);
 async function loadHistory(){const result=await api<{items:Credit[]}>('/admin/users/'+user.id+'/balance/credits');setHistory(result.items)}
 useEffect(()=>{let live=true;void api<{items:Credit[]}>('/admin/users/'+user.id+'/balance/credits').then(result=>{if(live)setHistory(result.items)}).catch(e=>{if(live)setError((e as Error).message)});return()=>{live=false}},[user.id]);
 async function submit(){
  if(sending.current||!valid||receipt)return;
  if(!request.current){request.current={amount:normalized!,reason:normalizedReason,idempotencyKey:crypto.randomUUID()};try{sessionStorage.setItem(storageKey,JSON.stringify(request.current))}catch{}}
  sending.current=true;setBusy(true);onBusy(true);setError('');
  try{
   const result=await api<Credit>('/admin/users/'+user.id+'/balance/credits',request.current);
   setReceipt(result);try{sessionStorage.removeItem(storageKey)}catch{}
   // A refresh failure cannot turn a confirmed credit into another attempted payment.
   const updates=await Promise.allSettled([onCredited(),loadHistory()]);if(updates.some(row=>row.status==='rejected'))setError(t('Зачисление подтверждено. Не удалось обновить часть данных; обновите страницу.'));
  }catch(e){setError((e as Error).message);if([400,404,409].includes((e as Error&{status?:number}).status||0)){request.current=null;try{sessionStorage.removeItem(storageKey)}catch{}setReview(false)}}finally{sending.current=false;setBusy(false);onBusy(false)}
 }
 const reset=()=>{request.current=null;setReceipt(null);setAmount('');setReason('');setReview(false);setError('');setOpen(true)};
 return <section ref={surface} className="owner-credit panel" aria-labelledby="owner-credit-title" aria-busy={busy}>
  <h3 id="owner-credit-title">{t('Пополнить баланс')}</h3><p>{t('Зачисление на доступный баланс. Это служебная операция, отдельная от перевода TON.')}</p>
  {!open?<button className="secondary" onClick={()=>setOpen(true)}>{t('Пополнить баланс')}</button>:<>
   <dl className="owner-credit-recipient"><div><dt>{t('Получатель')}</dt><dd>{user.name}{user.username?' · @'+user.username:''} · ID {user.id}</dd></div><div><dt>{t('Доступный баланс')}</dt><dd>{exactMoney(balance,locale)} USDT</dd></div></dl>
   {receipt?<div role="status" className="owner-success"><b>{t('Зачислено')} {exactMoney(receipt.amount,locale)} USDT</b><p>{t('Получатель')}: ID {receipt.userId}<br/>{t('Операция')}: {receipt.id}<br/>{t('Баланс после операции')}: {exactMoney(receipt.balanceAfter,locale)} USDT</p><button className="secondary" onClick={reset}>{t('Новое пополнение')}</button></div>:<form onSubmit={e=>{e.preventDefault();if(review)void submit();else if(valid){setError('');setReview(true)}}}>
    <label>{t('Сумма USDT')}<input name="creditAmount" inputMode="decimal" autoComplete="off" required maxLength={21} value={amount} disabled={busy||Boolean(request.current)||review} onChange={e=>setAmount(e.target.value)} placeholder="12.345678" aria-describedby="credit-precision"/></label><small id="credit-precision">{t('До 6 знаков после запятой. Сумма сохраняется точно.')}</small>
    <label>{t('Основание для служебной истории')}<textarea name="creditReason" required minLength={3} maxLength={500} value={reason} disabled={busy||Boolean(request.current)||review} onChange={e=>setReason(e.target.value)} rows={3}/></label>
    {review&&<p className="owner-credit-confirm">{t('Получатель')}: {user.name} · ID {user.id}<br/>{t('Пополнить на')} <b>{exactMoney(normalized!,locale)} USDT</b><br/>{t('Основание')}: {normalizedReason}</p>}
    {request.current&&!receipt&&<p>{t('Повтор использует тот же ключ операции и не создаёт второе зачисление.')}</p>}
    <div className="owner-credit-actions"><button className="primary" disabled={busy||!valid}>{busy?t('Отправка…'):review?t('Пополнить на')+' '+exactMoney(normalized!,locale)+' USDT':t('Проверить пополнение')}</button>{!request.current&&<button type="button" className="secondary" disabled={busy} onClick={()=>review?setReview(false):setOpen(false)}>{t(review?'Изменить':'Отмена')}</button>}</div>
   </form>}
  </>}
  {error&&<p role="alert" className="owner-error">{error}</p>}
  <details className="owner-credit-history"><summary>{t('Служебные пополнения')} · {history.length}</summary>{history.length?history.map(row=><article key={row.id}><b>+{exactMoney(row.amount,locale)} USDT</b><p>{row.reason}</p><small>ID {row.id} · {t('Владелец')}: {row.actorId} · {new Date(row.createdAt).toLocaleString(locale)}</small></article>):<p>{t('Служебных пополнений пока нет')}</p>}</details>
 </section>;
}
