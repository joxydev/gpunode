import {useLanguage,intlLocale} from './i18n';
import {useEffect,useRef,useState} from 'react';
import {api,Ticket} from './api';
import {Icon} from './Icons';

export const ticketLabels:Record<string,string>={OPEN:'Ожидает ответа',IN_PROGRESS:'В работе',ANSWERED:'Ответ получен',CLOSED:'Закрыто'};
const date=(value:string,language:'ru'|'en'|'ro')=>new Date(value).toLocaleString(intlLocale(language),{dateStyle:'short',timeStyle:'short'});

export default function SupportPanel({tickets,onRefresh}:{tickets:Ticket[];onRefresh:()=>Promise<void>}){
 const {t,language}=useLanguage();
 const [selected,setSelected]=useState(''),[detail,setDetail]=useState<Ticket|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const request=useRef(0),sending=useRef(false);
 async function openTicket(id:string,markRead=true){
  const generation=++request.current;setSelected(id);setLoading(true);setError('');
  try{
   const result=await api<Ticket>('/support/'+id);
   if(generation!==request.current)return;
   setDetail(result);
   if(markRead&&result.userUnread){await api('/support/'+id+'/read',{});if(generation===request.current){setDetail({...result,userUnread:false});await onRefresh()}}
  }catch(e){if(generation===request.current)setError((e as Error).message)}finally{if(generation===request.current)setLoading(false)}
 }
 useEffect(()=>{if(!selected)return;const summary=tickets.find(ticket=>ticket.id===selected);if(summary&&detail&&summary.updatedAt!==detail.updatedAt)void openTicket(selected,summary.userUnread)},[tickets,selected]);
 async function createTicket(form:HTMLFormElement){
  if(sending.current)return;const data=new FormData(form);sending.current=true;setBusy(true);setError('');setNotice('');
  try{const ticket=await api<Ticket>('/support',{category:data.get('category'),subject:data.get('subject'),message:data.get('message')});form.reset();setNotice(`${t("Обращение №")}${ticket.id.slice(0,8)} ${t("отправлено.")}`);await onRefresh();await openTicket(ticket.id,false)}catch(e){setError((e as Error).message)}finally{sending.current=false;setBusy(false)}
 }
 async function followUp(form:HTMLFormElement){
  if(!selected||sending.current)return;const data=new FormData(form);sending.current=true;setBusy(true);setError('');
  try{await api('/support/'+selected+'/messages',{message:data.get('message')});form.reset();await onRefresh();await openTicket(selected,false)}catch(e){setError((e as Error).message)}finally{sending.current=false;setBusy(false)}
 }
 return <section className="support-center">
  <span className="eyebrow">{t("SUPPORT CENTER")}</span><h2>{t("Поддержка")}</h2><p>{t("Диалог сохраняется в аккаунте. После ответа оператора здесь появится уведомление; писать можно до закрытия тикета.")}</p>
  {error&&<p role="alert" className="owner-error">{error}</p>}{notice&&<p role="status" className="owner-success">{notice}</p>}
  {!selected&&<>
   <form className="support-new" onSubmit={e=>{e.preventDefault();void createTicket(e.currentTarget)}}><label>{t("Тип обращения")}<select name="category"><option value="QUESTION">{t("Вопрос")}</option><option value="COMPLAINT">{t("Жалоба")}</option></select></label><label>{t("Тема")}<input name="subject" required minLength={3} maxLength={120} placeholder={t("Кратко опишите вопрос")}/></label><label>{t("Сообщение")}<textarea name="message" required minLength={5} maxLength={2000} placeholder={t("Что произошло и какая помощь нужна?")}/></label><button className="primary wide" disabled={busy}>{busy?t('Отправляем…'):t('Создать тикет')}</button></form>
   <div className="support-heading"><h3>{t("Мои обращения")}</h3><span>{tickets.length}</span></div>
   {!tickets.length&&<p className="owner-empty">{t("Обращений пока нет")}</p>}
   <div className="support-list">{tickets.map(ticket=>{const last=ticket.messages?.[0];return <button className={`support-ticket ${ticket.userUnread?'unread':''}`} key={ticket.id} onClick={()=>void openTicket(ticket.id,ticket.userUnread)}><span className="support-ticket-top"><b>{ticket.subject}</b><i>{t(ticketLabels[ticket.status]||ticket.status)}</i></span><span>{last?.body||t('Откройте обращение')}</span><small>#{ticket.id.slice(0,8)} · {date(ticket.lastMessageAt,language)}</small></button>})}</div>
  </>}
  {selected&&<div className="support-thread">
   <button className="owner-back" onClick={()=>{request.current++;setSelected('');setDetail(null)}}><Icon name="chevron" size={17}/> {t("Все обращения")}</button>
   {loading&&!detail?<p role="status">{t("Загружаем переписку…")}</p>:detail&&<>
    <div className="support-thread-head"><div><span>{detail.category==='COMPLAINT'?t('Жалоба'):t('Вопрос')} · #{detail.id.slice(0,8)}</span><h3>{detail.subject}</h3></div><i>{t(ticketLabels[detail.status])}</i></div>
    <div className="support-messages" aria-live="polite">{detail.messages.map(message=><article className={`support-message ${message.authorType==='OWNER'?'operator':'customer'}`} key={message.id}><b>{message.authorType==='OWNER'?t('Поддержка AetherMind'):t('Вы')}</b><p>{message.body}</p><time>{date(message.createdAt,language)}</time></article>)}</div>
    {detail.status==='CLOSED'?<div className="support-closed"><Icon name="lock" size={18}/><span>{t("Тикет закрыт оператором. Для нового вопроса создайте отдельное обращение.")}</span></div>:<form className="support-reply" onSubmit={e=>{e.preventDefault();void followUp(e.currentTarget)}}><label>{t("Дополнить обращение")}<textarea name="message" required minLength={2} maxLength={2000} placeholder={t("Напишите сообщение…")}/></label><button className="primary wide" disabled={busy}>{busy?t('Отправляем…'):t('Отправить сообщение')}</button></form>}
   </>}
  </div>}
 </section>
}
