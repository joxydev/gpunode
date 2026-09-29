import {useEffect,useRef,useState} from 'react';
import {api,type Account} from './api';
import {useLanguage,intlLocale} from './i18n';
import {useAppBack} from './navigation';
import {Icon} from './Icons';

export function epochDays(node:Account['activeNodes'][number],now=Date.now()){
 const start=Date.parse(node.activatedAt||(node.legacyTermsReview?node.createdAt:'')),end=Date.parse(node.epochEndsAt||node.expiresAt||''),day=86400000;
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return null;
 const total=node.contractDays||Math.max(1,Math.ceil((end-start)/day));
 return {current:Math.min(total,Math.max(1,Math.floor((now-start)/day)+1)),total,remaining:Math.max(0,Math.ceil((end-now)/day))};
}

type Quote={leaseId:string;allowed:boolean;principal:string;cycleDay:number;feePercent:string;fee:string;netPrincipal:string;epochEndsAt:string;mode:string;reason:string|null;clause:string};
export default function Assets({nodes,onMarket,onOffer,onRefresh}:{nodes:Account['activeNodes'];onMarket:()=>void;onOffer:()=>void;onRefresh:()=>Promise<void>}){
 const {t,language}=useLanguage(),locale=intlLocale(language);
 const [selected,setSelected]=useState<string|null>(null),detail=nodes.find(node=>node.id===selected);
 const [quote,setQuote]=useState<Quote|null>(null),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const opener=useRef<HTMLElement|null>(null);
 function open(id:string){opener.current=document.activeElement as HTMLElement;setSelected(id)}
 function back(){setSelected(null);requestAnimationFrame(()=>opener.current?.focus())}
 useAppBack(Boolean(detail),back);
 useEffect(()=>{setQuote(null);setReview(false);setError('');if(!detail||detail.status!=='ACTIVE'||detail.mode!=='BASE')return;let live=true;
  void api<Quote>(`/v1/leases/${detail.id}/unbond/quote`).then(result=>{if(live)setQuote(result)}).catch(e=>{if(live)setError((e as Error).message)});return()=>{live=false}},[selected,detail?.status,detail?.settledDays]);
 async function execute(){if(!detail||!quote?.allowed||busy)return;setBusy(true);setError('');try{await api(`/v1/leases/${detail.id}/unbond`,{idempotencyKey:crypto.randomUUID()});await onRefresh();setReview(false)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <section className="assets-page" aria-labelledby="assets-heading">
  {detail?<>
   <button className="secondary" onClick={back}>← {t('Мои ноды')}</button>
   <h1>{detail.node?.name||detail.nodeId}</h1><span className="chip">{t(detail.status)}</span>{detail.mode&&<span className="chip">{detail.mode}</span>}
   {error&&<p role="alert">{error}</p>}
   <div className="asset-detail-grid">
    <article className="panel"><h2>{t('Обзор')}</h2><p>{t('Epoch')}: {epochDays(detail)?`${epochDays(detail)!.current} / ${epochDays(detail)!.total}`:t('Срок уточняется')}</p><p>{t('До завершения')}: {epochDays(detail)?.remaining ?? '—'} {t('дней')}</p>{detail.principal&&<p>{t('Первоначальный депозит')}: {detail.principal} USDT</p>}{detail.mode==='BASE'&&<p>{t('Начисленная Base-прибыль')}: {detail.baseAccrued} USDT</p>}{detail.mode==='COMPOUND'&&<><p>{t('Капитализировано внутри активного Epoch')}: {detail.compoundCapital} USDT</p><p>{t('Compound-блок')}: {detail.currentCompoundBlock} / {(detail.contractDays||30)/30}</p></>}{detail.mode&&<p>{t('Ставка')}: {((detail.mode==='BASE'?detail.baseDailyRateBps:detail.compoundDailyRateBps)||0)/100}% / {t('сутки')}</p>}</article>
    <article className="panel"><h2>{t('Жизненный цикл')}</h2><p>{t('Заказ')}: {new Date(detail.createdAt).toLocaleDateString(locale)}</p><p>{t('Активация')}: {detail.activatedAt?new Date(detail.activatedAt).toLocaleString(locale):t('Ожидает оператора')}</p><p>{t('Завершение')}: {detail.epochEndsAt||detail.expiresAt?new Date(detail.epochEndsAt||detail.expiresAt!).toLocaleString(locale):'—'}</p></article>
    <article className="panel"><h2>{t('Инфраструктура')}</h2><p>{t('Назначение оборудования и нагрузки уточняется оператором.')}</p></article>
    <article className="panel"><h2>{t('Условия')}</h2>{detail.offerVersion&&<p>{t('Редакция')}: {detail.offerVersion}</p>}{detail.legacyTermsReview&&<p>LEGACY_TERMS_REVIEW</p>}<button className="text-button" onClick={onOffer}>{t('Открыть оферту')} <Icon name="arrow" size={16}/></button></article>
   </div>
   {detail.status==='ACTIVE'&&detail.mode==='COMPOUND'&&<div className="panel"><h2>{t('Early Unbonding недоступен')}</h2><p>{t('Основной депозит и капитализированная прибыль заблокированы до завершения Epoch.')}</p></div>}
   {detail.status==='ACTIVE'&&detail.mode==='BASE'&&quote?.allowed&&<div className="panel"><button className="secondary" onClick={()=>setReview(true)}>{t('Досрочно завершить Epoch')}</button>{review&&<div className="production-detail"><h2>{t('Досрочная расшнуровка')}</h2><dl><div><dt>{t('Первоначальный депозит')}</dt><dd>{quote.principal} USDT</dd></div><div><dt>{t('Текущий день Epoch')}</dt><dd>{quote.cycleDay} / {detail.contractDays}</dd></div><div><dt>{t('Комиссия по п. 5.7')}</dt><dd>{quote.feePercent}%</dd></div><div><dt>Early Unbonding Fee</dt><dd>{quote.fee} USDT</dd></div><div><dt>{t('Вернётся на внутренний баланс')}</dt><dd>{quote.netPrincipal} USDT</dd></div></dl><p>{t('Ранее начисленная базовая прибыль не удерживается.')}</p><button className="primary" disabled={busy} onClick={()=>void execute()}>{t('Подтвердить')}</button><button className="secondary" onClick={()=>setReview(false)}>{t('Отмена')}</button></div>}</div>}
  </>:<>
   <header className="section-title"><h1 id="assets-heading">{t('Мои ноды')}</h1><span className="micro">EPOCH</span></header>
   {nodes.length?<div className="asset-list">{nodes.map(node=>{const days=epochDays(node);return <button className="panel asset-row" key={node.id} onClick={()=>open(node.id)}><span><b>{node.node?.name||node.nodeId}</b><small>{t(node.status)} · {node.mode||'—'} · {days?`${t('День')} ${days.current} / ${days.total}`:t('Срок уточняется')}</small></span><span>{new Date(node.createdAt).toLocaleDateString(locale)} – {node.epochEndsAt||node.expiresAt?new Date(node.epochEndsAt||node.expiresAt!).toLocaleDateString(locale):'—'}</span><Icon name="chevron" size={18}/></button>})}</div>:<div className="empty panel"><Icon name="node" size={30}/><h2>{t('Активных нод пока нет')}</h2><p>{t('После одобрения заявки оператор назначит оборудование, и оно появится здесь.')}</p><button className="secondary" onClick={onMarket}>{t('Открыть тарифы')}</button></div>}
  </>}
 </section>;
}
