import {useEffect,useState} from 'react';
import {api} from './api';
import {useLanguage,intlLocale} from './i18n';
import {statusLabels,type NotificationItem} from './production-types';
import {ListRow,EmptyState,IconContainer} from './UI';
import './production.css';

const titles:Record<string,string>={ADMIN_CREDIT:'Пополнение администратором',DEPOSIT_CREATED:'Счёт на пополнение создан',DEPOSIT_CREDITED:'Пополнение подтверждено',DEPOSIT_MANUAL_REVIEW:'Пополнение требует проверки',WITHDRAWAL_CREATED:'Заявка на вывод создана',WITHDRAWAL_UPDATED:'Статус вывода изменён',SUPPORT_REPLY:'Ответ поддержки',ORDER_CREATED:'Заявка создана',ORDER_UPDATED:'Заявка обновлена',EPOCH_STARTED:'Начисления начались',EPOCH_ENDING:'Срок работы завершается',EPOCH_COMPLETED:'Срок работы завершён',SECURITY:'Безопасность',SYSTEM:'Системное событие'};
export default function NotificationsCenter({onRefresh,onReference,userId}:{userId:string;onRefresh:()=>Promise<void>;onReference:(type:string,id:string)=>void}){
 const {t,language}=useLanguage(),locale=intlLocale(language);
 const [items,setItems]=useState<NotificationItem[]|null>(null),[unread,setUnread]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){const data=await api<{items:NotificationItem[];unread:number}>('/v1/notifications');setItems(data.items);setUnread(data.unread)}
 useEffect(()=>{void load().catch(e=>setError((e as Error).message))},[]);
 async function read(item:NotificationItem){setBusy(true);setError('');try{if(!item.isRead)await api('/v1/notifications/'+item.id+'/read',{});await load();await onRefresh();if(item.referenceType&&item.referenceId)onReference(item.referenceType,item.referenceId)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function readAll(){setBusy(true);setError('');try{await api('/v1/notifications/read-all',{});await load();await onRefresh()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const [preferences]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(localStorage.getItem('aethermind.notifications.'+userId)||'{}')}catch{return {}}});
 const category=(type:string)=>type.startsWith('DEPOSIT')||type.startsWith('WITHDRAWAL')||type==='ADMIN_CREDIT'?'Платежи':type.startsWith('ORDER')?'Тарифы':type.startsWith('EPOCH')?'Epoch':type==='SUPPORT_REPLY'?'Поддержка':'Системные события';
 const visibleItems=items?.filter(item=>preferences[category(item.type)]!==false)||[];
 const today=new Date().toDateString();
 return <section className="production-page" aria-labelledby="notifications-title"><div className="production-heading"><h2 id="notifications-title">{t('Уведомления')}</h2><span aria-live="polite">{unread} {t('непрочитано')}</span></div>
  {Boolean(unread)&&<button className="secondary" disabled={busy} onClick={()=>void readAll()}>{t('Прочитать все')}</button>}
  {error&&<div className="production-problem" role="alert"><p>{error}</p><button className="secondary" onClick={()=>void load().then(()=>setError('')).catch(e=>setError((e as Error).message))}>{t('Повторить')}</button></div>}
  {items===null?<div className="activity-skeleton" role="status" aria-label={t('Загрузка…')}><i/><i/><i/></div>:!visibleItems.length?<EmptyState icon="bell" title={t('Уведомлений пока нет')} description={t('Здесь будут статусы платежей, начислений и ответы поддержки.')}/>:<div className="production-list">{visibleItems.map((item,index)=><div key={item.id}>{(index===0||new Date(visibleItems[index-1].createdAt).toDateString()!==new Date(item.createdAt).toDateString())&&<h3>{t(new Date(item.createdAt).toDateString()===today?'Сегодня':'Ранее')}</h3>}<button className={'production-row '+(!item.isRead?'unread':'')} disabled={busy} onClick={()=>void read(item)}><IconContainer name={item.type.startsWith('DEPOSIT')||item.type==='ADMIN_CREDIT'?'download':item.type.startsWith('WITHDRAWAL')?'send':item.type.startsWith('ORDER')?'node':item.type.startsWith('EPOCH')?'bolt':item.type==='SUPPORT_REPLY'?'help':item.type==='SECURITY'?'shield':'bell'}/><span><b>{t(titles[item.type]||item.title)}</b><small>{item.type==='ADMIN_CREDIT'?t('На доступный баланс зачислено {amount} USDT.',{amount:item.message.match(/[0-9]+(?:\.[0-9]+)?/)?.[0]||'—'}):item.type==='WITHDRAWAL_UPDATED'?t(statusLabels[item.message.split(' · ')[0]]||item.message.split(' · ')[0])+' · '+item.message.split(' · ').slice(1).join(' · '):item.message}</small></span><span className="notification-meta">{!item.isRead&&<small className="notification-unread">{t('Новое')}</small>}<time>{new Date(item.createdAt).toLocaleString(locale,{dateStyle:'short',timeStyle:'short'})}</time></span></button></div>)}</div>}
 </section>;
}
