import {useRef,useState} from 'react';
import type {Account} from './api';
import {useLanguage,intlLocale} from './i18n';
import {useAppBack} from './navigation';
import {Icon} from './Icons';

export function epochDays(node:Account['activeNodes'][number],now=Date.now()){
 const start=Date.parse(node.createdAt),end=Date.parse(node.expiresAt),day=86400000;
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return null;
 const total=Math.max(1,Math.ceil((end-start)/day));
 return {current:Math.min(total,Math.max(1,Math.floor((now-start)/day)+1)),total,remaining:Math.max(0,Math.ceil((end-now)/day))};
}

export default function Assets({nodes,onMarket,onOffer}:{nodes:Account['activeNodes'];onMarket:()=>void;onOffer:()=>void}){
 const {t,language}=useLanguage(),locale=intlLocale(language);
 const [selected,setSelected]=useState<string|null>(null),detail=nodes.find(node=>node.id===selected);
 const opener=useRef<HTMLElement|null>(null);
 function open(id:string){opener.current=document.activeElement as HTMLElement;setSelected(id)}
 function back(){setSelected(null);requestAnimationFrame(()=>opener.current?.focus())}
 useAppBack(Boolean(detail),back);
 return <section className="assets-page" aria-labelledby="assets-heading">
  {detail?<>
   <button className="secondary" onClick={back}>← {t('Мои ноды')}</button>
   <h1>{detail.node.name}</h1><span className="chip">{t(detail.status)}</span>
   <div className="asset-detail-grid">
    <article className="panel"><h2>{t('Обзор')}</h2><p>{t('Epoch')}: {epochDays(detail)?`${epochDays(detail)!.current} / ${epochDays(detail)!.total}`:t('Срок уточняется')}</p><p>{t('До завершения')}: {epochDays(detail)?.remaining ?? '—'} {t('дней')}</p></article>
    <article className="panel"><h2>{t('Жизненный цикл')}</h2><p>{t('Активация')}: {new Date(detail.createdAt).toLocaleDateString(locale)}</p><p>{t('Завершение')}: {new Date(detail.expiresAt).toLocaleDateString(locale)}</p></article>
    <article className="panel"><h2>{t('Инфраструктура')}</h2><p>{t('Назначение оборудования и нагрузки уточняется оператором.')}</p></article>
    <article className="panel"><h2>{t('Условия')}</h2><button className="text-button" onClick={onOffer}>{t('Открыть оферту')} <Icon name="arrow" size={16}/></button></article>
   </div>
  </>:<>
   <header className="section-title"><h1 id="assets-heading">{t('Мои ноды')}</h1><span className="micro">EPOCH</span></header>
   {nodes.length?<div className="asset-list">{nodes.map(node=>{const days=epochDays(node);return <button className="panel asset-row" key={node.id} onClick={()=>open(node.id)}><span><b>{node.node.name}</b><small>{t(node.status)} · {days?`${t('День')} ${days.current} / ${days.total}`:t('Срок уточняется')}</small></span><span>{new Date(node.createdAt).toLocaleDateString(locale)} – {new Date(node.expiresAt).toLocaleDateString(locale)}</span><Icon name="chevron" size={18}/></button>})}</div>:<div className="empty panel"><Icon name="node" size={30}/><h2>{t('Активных нод пока нет')}</h2><p>{t('После одобрения заявки оператор назначит оборудование, и оно появится здесь.')}</p><button className="secondary" onClick={onMarket}>{t('Открыть тарифы')}</button></div>}
  </>}
 </section>;
}
