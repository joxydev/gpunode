import {useEffect,useState} from 'react';
import {api,type Lease} from './api';
import {useLanguage,intlLocale} from './i18n';
import {statusLabels} from './production-types';
import './production.css';

type Row=Lease&{user:{id:string;name:string;username:string|null};request:{paymentStatus:string;decision:string|null;closureReason:string|null}|null};
export default function OwnerLeases({onRefresh}:{onRefresh:()=>Promise<void>}){
 const {t,language}=useLanguage(),locale=intlLocale(language);
 const [items,setItems]=useState<Row[]|null>(null),[selected,setSelected]=useState<Row|null>(null),[page,setPage]=useState(0),[reason,setReason]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){const rows=await api<{items:Row[]}>('/v1/admin/leases?page='+page);setItems(rows.items);setSelected(previous=>previous?rows.items.find(row=>row.id===previous.id)||null:null)}
 useEffect(()=>{void load().catch(e=>setError((e as Error).message))},[page]);
 async function action(kind:'activate'|'reject'){if(!selected||busy)return;setBusy(true);setError('');try{
  await api(`/v1/admin/leases/${selected.id}/${kind}`,kind==='reject'?{reason:reason.trim()}:{});
  setConfirm(false);setReason('');await load();await onRefresh();
 }catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <section className="production-page"><h2>{t('Заказы и Epoch')}</h2><p>{t('Списание, возврат и активация фиксируются в ledger. Начисления производит только системный worker.')}</p>
  {error&&<p role="alert" className="owner-error">{error}</p>}
  {items===null?<p role="status">{t('Загрузка…')}</p>:items.length?<div className="production-list">{items.map(row=><button className="production-row" key={row.id} onClick={()=>{setSelected(row);setConfirm(false)}} aria-expanded={selected?.id===row.id}><span><b>{row.user.name} · {row.node?.name||row.nodeId}</b><small>{row.principal||'—'} USDT · {row.mode||'—'} · {new Date(row.createdAt).toLocaleString(locale)}</small></span><span>{t(statusLabels[row.status]||row.status)}</span></button>)}</div>:<p className="production-empty">{t('Заказов пока нет')}</p>}
  {selected&&<article className="panel production-detail"><h3>{selected.node?.name||selected.nodeId}</h3><dl><div><dt>{t('Пользователь')}</dt><dd>{selected.user.name} · {selected.user.id}</dd></div><div><dt>{t('Первоначальный депозит')}</dt><dd>{selected.principal} USDT</dd></div><div><dt>{t('Режим')}</dt><dd>{selected.mode}</dd></div><div><dt>{t('Ставка')}</dt><dd>{((selected.mode==='COMPOUND'?selected.compoundDailyRateBps:selected.baseDailyRateBps)||0)/100}% / {t('сутки')}</dd></div><div><dt>Epoch</dt><dd>{selected.contractDays} {t('дней')}</dd></div><div><dt>{t('Редакция')}</dt><dd>{selected.offerVersion||'LEGACY_TERMS_REVIEW'}</dd></div><div><dt>{t('Оплата')}</dt><dd>{selected.request?.paymentStatus||'—'}</dd></div><div><dt>{t('Заказ')}</dt><dd>{new Date(selected.createdAt).toLocaleString(locale)}</dd></div><div><dt>{t('Активация')}</dt><dd>{selected.activatedAt?new Date(selected.activatedAt).toLocaleString(locale):'—'}</dd></div><div><dt>{t('Завершение')}</dt><dd>{selected.epochEndsAt?new Date(selected.epochEndsAt).toLocaleString(locale):'—'}</dd></div><div><dt>{t('Статус')}</dt><dd>{t(statusLabels[selected.status]||selected.status)}</dd></div></dl>
   {selected.status==='PROVISIONING'&&selected.offerVersion&&<div className="production-form">{!confirm?<div className="production-actions"><button className="primary" onClick={()=>setConfirm(true)}>{t('Активировать оборудование')}</button><button className="secondary" onClick={()=>setConfirm(true)}>{t('Отклонить заказ')}</button></div>:<><p>{t('После активации ставка, principal, режим и срок не меняются.')}</p><button className="primary" disabled={busy} onClick={()=>void action('activate')}>{t('Подтвердить активацию')}</button><label>{t('Причина отказа')}<textarea value={reason} minLength={3} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label><button className="secondary" disabled={busy||reason.trim().length<3} onClick={()=>void action('reject')}>{t('Отклонить и вернуть депозит')}</button><button className="text-button" onClick={()=>setConfirm(false)}>{t('Отмена')}</button></>}</div>}
  </article>}
  <div className="production-actions"><button className="secondary" disabled={page===0||busy} onClick={()=>setPage(v=>v-1)}>{t('Назад')}</button><span>{page+1}</span><button className="secondary" disabled={busy||!items?.length||items.length<30} onClick={()=>setPage(v=>v+1)}>{t('Далее')}</button></div>
 </section>;
}
