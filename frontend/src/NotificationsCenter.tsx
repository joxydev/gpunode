import {useEffect,useState} from 'react';
import {api} from './api';
import {useLanguage,intlLocale} from './i18n';
import {statusLabels,type NotificationItem} from './production-types';
import './production.css';

const titles:Record<string,string>={DEPOSIT_CREATED:'Счёт на пополнение создан',DEPOSIT_CREDITED:'Пополнение подтверждено',DEPOSIT_MANUAL_REVIEW:'Пополнение требует проверки',WITHDRAWAL_CREATED:'Заявка на вывод создана',WITHDRAWAL_UPDATED:'Статус вывода изменён',SUPPORT_REPLY:'Ответ поддержки',ORDER_CREATED:'Заявка создана',ORDER_UPDATED:'Заявка обновлена',EPOCH_STARTED:'Epoch начался',EPOCH_ENDING:'Epoch завершается',EPOCH_COMPLETED:'Epoch завершён',SECURITY:'Безопасность',SYSTEM:'Системное событие'};
export default function NotificationsCenter({onRefresh,onReference}:{onRefresh:()=>Promise<void>;onReference:(type:string,id:string)=>void}){
 const {t,language}=useLanguage(),locale=intlLocale(language);
 const [items,setItems]=useState<NotificationItem[]|null>(null),[unread,setUnread]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){const data=await api<{items:NotificationItem[];unread:number}>('/v1/notifications');setItems(data.items);setUnread(data.unread)}
 useEffect(()=>{void load().catch(e=>setError((e as Error).message))},[]);
 async function read(item:NotificationItem){setBusy(true);setError('');try{if(!item.isRead)await api('/v1/notifications/'+item.id+'/read',{});await load();await onRefresh();if(item.referenceType&&item.referenceId)onReference(item.referenceType,item.referenceId)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function readAll(){setBusy(true);setError('');try{await api('/v1/notifications/read-all',{});await load();await onRefresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const today=new Date().toDateString();
 return <section className="production-page" aria-labelledby="notifications-title"><div className="production-heading"><h2 id="notifications-title">{t('Уведомления')}</h2><span aria-live="polite">{unread} {t('непрочитано')}</span></div>
  {Boolean(unread)&&<button className="secondary" disabled={busy} onClick={()=>void readAll()}>{t('Прочитать все')}</button>}
  {error&&<p role="alert" className="owner-error">{error}</p>}
  {items===null?<div className="activity-skeleton" role="status" aria-label={t('Загрузка…')}><i/><i/><i/></div>:!items.length?<div className="production-empty"><p>{t('Уведомлений пока нет')}</p></div>:<div className="production-list">{items.map((item,index)=><div key={item.id}>{(index===0||new Date(items[index-1].createdAt).toDateString()!==new Date(item.createdAt).toDateString())&&<h3>{t(new Date(item.createdAt).toDateString()===today?'Сегодня':'Ранее')}</h3>}<button className={'production-row '+(!item.isRead?'unread':'')} disabled={busy} onClick={()=>void read(item)}><span aria-hidden="true">{item.isRead?'✓':'●'}</span><span><b>{t(titles[item.type]||item.title)}</b><small>{item.type==='WITHDRAWAL_UPDATED'?t(statusLabels[item.message.split(' · ')[0]]||item.message.split(' · ')[0])+' · '+item.message.split(' · ').slice(1).join(' · '):item.message}</small></span><time>{new Date(item.createdAt).toLocaleString(locale,{dateStyle:'short',timeStyle:'short'})}</time></button></div>)}</div>}
 </section>;
}
