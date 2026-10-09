import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {api,type Account} from './api';
import {useLanguage,intlLocale} from './i18n';
import {useAppBack} from './navigation';
import {Icon} from './Icons';
import {IconContainer,StatusPill,Money,PageHeader} from './UI';
import {statusLabels} from './production-types';
import {GpuDetail,GpuSummary} from './GpuLive';
import {useSurfaceMotion} from './motion';

export {epochDays} from './gpu-terms';

type Quote={leaseId:string;allowed:boolean;principal:string;cycleDay:number;feePercent:string;fee:string;netPrincipal:string;epochEndsAt:string;mode:string;reason:string|null;clause:string};
export default function Assets({nodes,onMarket,onOffer,onRefresh,onBack,initialLeaseId,onGpuReturn}:{initialLeaseId?:string|null;onGpuReturn?:()=>void;onBack?:()=>void;nodes:Account['activeNodes'];onMarket:()=>void;onOffer:()=>void;onRefresh:()=>Promise<void>}){
 const {t,language}=useLanguage(),locale=intlLocale(language);
 const [selected,setSelected]=useState<string|null>(initialLeaseId||null),detail=nodes.find(node=>node.id===selected);
 const [quote,setQuote]=useState<Quote|null>(null),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pageRef=useRef<HTMLElement>(null);useSurfaceMotion(pageRef,selected,'detail');
 const opener=useRef<HTMLElement|null>(null),focusIntent=useRef<{top:number;id:string}|null>(null);
 function open(id:string){opener.current=document.getElementById('gpu-row-'+id);position.current=window.scrollY;focusIntent.current={top:0,id:'assets-heading'};setSelected(id)}
 const position=useRef(0);
 function back(){if(busy)return;if(initialLeaseId&&onGpuReturn){onGpuReturn();return;}focusIntent.current={top:position.current,id:opener.current?.id||'assets-heading'};setSelected(null)}
 useLayoutEffect(()=>{const intent=focusIntent.current;if(intent){focusIntent.current=null;window.scrollTo({top:intent.top});document.getElementById(intent.id)?.focus({preventScroll:true})}},[selected]);
 useAppBack(Boolean(detail),back);
 useEffect(()=>{setQuote(null);setReview(false);setError('');if(!detail||detail.status!=='ACTIVE'||detail.mode!=='BASE')return;let live=true;
  void api<Quote>(`/v1/leases/${detail.id}/unbond/quote`).then(result=>{if(live)setQuote(result)}).catch(e=>{if(live)setError((e as Error).message)});return()=>{live=false}},[selected,detail?.status,detail?.settledDays]);
 async function execute(){if(!detail||!quote?.allowed||busy)return;setBusy(true);setError('');try{await api(`/v1/leases/${detail.id}/unbond`,{idempotencyKey:crypto.randomUUID()});await onRefresh();setReview(false)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <section ref={pageRef} className="assets-page" aria-labelledby="assets-heading" aria-busy={busy}>
  {detail?<>
   <PageHeader id="assets-heading" title={detail.node?.name||detail.nodeId} onBack={back} backLabel={t('Мои GPU')}/>
   {error&&<p role="alert">{error}</p>}
   <GpuDetail node={detail} onRefresh={onRefresh}/>
   <div className="asset-detail-grid">
    <article className="panel"><h2>{t('Период работы')}</h2><p>{t('Заказ')}: {new Date(detail.createdAt).toLocaleDateString(locale)}</p><p>{t('Активация')}: {detail.activatedAt?new Date(detail.activatedAt).toLocaleString(locale):t('Ожидает оператора')}</p><p>{t('Завершение')}: {detail.epochEndsAt||detail.expiresAt?new Date(detail.epochEndsAt||detail.expiresAt!).toLocaleString(locale):'—'}</p></article>
    <article className="panel"><h2>{t('Условия')}</h2><p>{t('Назначение оборудования и нагрузки уточняется оператором.')}</p>{detail.offerVersion&&<p>{t('Редакция')}: {detail.offerVersion}</p>}{detail.legacyTermsReview&&<p>LEGACY_TERMS_REVIEW</p>}<button className="text-button" onClick={onOffer}>{t('Открыть оферту')} <Icon name="arrow" size={16}/></button></article>
   </div>
   {detail.status==='ACTIVE'&&detail.mode==='COMPOUND'&&<div className="panel"><h2>{t('Early Unbonding недоступен')}</h2><p>{t('Основной депозит и капитализированная прибыль заблокированы до завершения Epoch.')}</p></div>}
   {detail.status==='ACTIVE'&&detail.mode==='BASE'&&quote?.allowed&&<div className="panel"><button className="secondary" onClick={()=>setReview(true)}>{t('Досрочно завершить Epoch')}</button>{review&&<div className="production-detail"><h2>{t('Досрочное завершение Epoch')}</h2><dl><div><dt>{t('Первоначальный депозит')}</dt><dd><Money value={quote.principal||'0'}/></dd></div><div><dt>{t('Текущий день Epoch')}</dt><dd>{quote.cycleDay} / {detail.contractDays}</dd></div><div><dt>{t('Комиссия по п. 5.5')}</dt><dd>{quote.feePercent}%</dd></div><div><dt>Early Unbonding Fee</dt><dd><Money value={quote.fee||'0'}/></dd></div><div><dt>{t('Вернётся на внутренний баланс')}</dt><dd><Money value={quote.netPrincipal||'0'}/></dd></div></dl><p>{t('Ранее начисленная базовая прибыль не удерживается.')}</p><button className="primary" disabled={busy} onClick={()=>void execute()}>{t('Подтвердить')}</button><button className="secondary" onClick={()=>setReview(false)}>{t('Отмена')}</button></div>}</div>}
  </>:<>
   <PageHeader id="assets-heading" title={t('Мои GPU')} onBack={onBack} backLabel={t('Профиль')}/>
   {nodes.length?<div className="asset-list">{nodes.map((node,index)=><GpuSummary key={node.id} node={node} eager={index===0} onOpen={()=>open(node.id)} onRefresh={onRefresh}/>)}</div>:<div className="empty panel"><Icon name="node" size={30}/><h2>{t('Активных GPU пока нет')}</h2><p>{t('После одобрения заявки оператор назначит оборудование, и оно появится здесь.')}</p><button className="secondary" onClick={onMarket}>{t('Открыть тарифы')}</button></div>}
  </>}
 </section>;
}
