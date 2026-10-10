import {ProtectedArt} from './ProtectedArt';
import {api} from './api';
import {networkCopy} from './network-copy';
import {useLanguage,type Language} from './i18n';
import {useEffect,useState} from 'react';
import {Icon} from './Icons';
import './offer.css';

export const OFFER_VERSION='88-2026-AI-NETWORK-2026-10-10-R2';
export const OFFER_DOCUMENT_SHA256='bfee177869e0c6d13c189df6eff3f772bb7a89509b9512711c3eb7ffdac52a0b';
const PDF='/documents/public-offer-aethermind-network-2026-10-10-r2.pdf';
const copy:Record<Language,{date:string;intro:string;net:string;withdraw:string;early:string;paused:string;open:string;prompt:string;check:string;accept:string;busy:string;hint:string}>={
 ru:{date:'Актуальная редакция · дополнение 4.3 · 7 страниц',intro:'Полный русский текст в PDF является источником условий. Это краткое описание его не заменяет.',net:'Пункт 5.1: USDT только в сети TON (Jetton), комиссия платформы за ввод 0%; пополнение через динамические инвойсы.',withdraw:'Пункт 5.3: вывод прибыли от 10 USDT, комиссия платформы 0%, заявленный срок обработки 15 минут — 24 часа.',early:'Пункты 5.4–5.5: Compound Boost выбирается отдельно и исключает досрочный вывод. Без него комиссия с депозита: дни 1–14 — 15%, 15–29 — 7%, 30–59 для Beta/POD — 3%, 60–89 для POD — 1,5%; после Epoch — 0%.',paused:'Доступность заказов и начислений показана отдельно в состоянии системы. Заявки на вывод рассматриваются оператором.',open:'Открыть полный PDF',prompt:'Откройте полный PDF и прочитайте документ до принятия.',check:'Я открыл(а), прочитал(а) и принимаю редакцию с дополнением 4.3.',accept:'Принять новую редакцию',busy:'Фиксируем акцепт…',hint:'Сначала откройте PDF и отметьте согласие.'},
 en:{date:'Current edition · clause 4.3 · 7 pages',intro:'The full Russian PDF is the authoritative text. This summary does not replace it.',net:'Clause 5.1: USDT on TON Jetton only, 0% platform deposit fee; deposits use dynamic invoices.',withdraw:'Clause 5.3: profit withdrawals from 10 USDT, 0% platform fee, stated processing time 15 minutes to 24 hours.',early:'Clauses 5.4–5.5: Compound Boost is optional and excludes early withdrawal. Base principal fee: days 1–14: 15%, 15–29: 7%, Beta/POD days 30–59: 3%, POD days 60–89: 1.5%; 0% after the Epoch.',paused:'The system status shows current order and accrual availability. An operator reviews withdrawal requests.',open:'Open the full PDF',prompt:'Open and read the full PDF before accepting.',check:'I opened, read and accept the edition with clause 4.3.',accept:'Accept the new edition',busy:'Recording acceptance…',hint:'Open the PDF first and then check the consent box.'},
 ro:{date:'Ediția actuală · clauza 4.3 · 7 pagini',intro:'Textul complet în rusă din PDF este sursa condițiilor. Rezumatul nu îl înlocuiește.',net:'Clauza 5.1: USDT numai în rețeaua TON Jetton; comisionul platformei pentru depunere este 0%, folosind facturi dinamice.',withdraw:'Clauza 5.3: retragerea profitului de la 10 USDT, comisionul platformei 0%, termenul indicat 15 minute–24 ore.',early:'Clauzele 5.4–5.5: Compound Boost se alege separat și exclude retragerea anticipată. Taxa din depozitul Base: zilele 1–14: 15%, 15–29: 7%, Beta/POD 30–59: 3%, POD 60–89: 1,5%; 0% după Epoch.',paused:'Starea sistemului arată disponibilitatea comenzilor și acumulărilor. Cererile de retragere sunt analizate de operator.',open:'Deschide PDF-ul complet',prompt:'Deschide și citește PDF-ul complet înainte de acceptare.',check:'Am deschis, citit și accept ediția cu clauza 4.3.',accept:'Acceptă ediția nouă',busy:'Înregistrăm acceptarea…',hint:'Deschide mai întâi PDF-ul și apoi bifează acordul.'}
};
const publicationCopy:Record<Language,string>={ru:'Вступает в силу с момента публикации на платформе.',en:'Effective from the moment of publication on the platform.',ro:'Intră în vigoare din momentul publicării pe platformă.'};
const reviewCopy:Record<Language,string>={ru:'Опубликована новая оферта. Ознакомьтесь и подтвердите согласие.',en:'A new offer is published. Read it and confirm your consent.',ro:'A fost publicată o ofertă nouă. Citește-o și confirmă acordul.'};
const rows=[['Node Alpha','50',30,'1.5%','1.8%'],['Cluster Beta','300',60,'2.5%','3.0%'],['Enterprise POD','1 200',90,'3.5%','4.2%'],['Quantum Array','5 000',180,'—','—']] as const;
export function OfferDocument({onOpen}:{onOpen?:()=>void}){
 const {language}=useLanguage(),s=copy[language],[regulation,setRegulation]=useState<{publishedAt:string;effectiveAt:string}|null>(null);useEffect(()=>{let active=true;api<{publishedAt:string;effectiveAt:string}>('/v1/network/regulation').then(v=>{if(active)setRegulation(v)}).catch(()=>{});return()=>{active=false}},[]);
 return <article className="offer-copy" lang={language}>
  <header><span className="eyebrow">AETHERMIND / PUBLIC OFFER</span><h1>№ 88/2026-AI</h1><small>{s.date}</small></header>
  <p className="offer-note">{s.intro}</p><p>{publicationCopy[language]}</p>{regulation&&<p>{new Date(regulation.publishedAt).toLocaleString(language)} · {networkCopy[language].effective}: {new Date(regulation.effectiveAt).toLocaleString(language)}</p>}
  <div className="offer-rate-list">{rows.map(([name,price,days,base,boost])=><article className="offer-rate" key={name}><h3>{name} · {price} USDT</h3><p>Epoch {days} · Base {base} · Boost {boost}</p></article>)}</div>
  <p>{s.net}</p><p>{s.withdraw}</p><p>{s.early}</p><p className="offer-note">{s.paused}</p>
  <a className="offer-download" href={PDF} target="_blank" rel="noopener noreferrer" onClick={onOpen}><Icon name="arrow" size={18}/>{s.open}</a>
 </article>;
}
export function OfferReminder({onOpen}:{onOpen:()=>void}){const {language}=useLanguage();return <aside className="offer-reminder panel"><p>{reviewCopy[language]}</p><button className="secondary" onClick={onOpen}>{copy[language].open}</button></aside>}
export function OfferReview({onAccept,busy=false,error='',accepted=false}:{onAccept?:()=>Promise<void>;busy?:boolean;error?:string;accepted?:boolean}){
 const {language}=useLanguage(),s=copy[language];
 const [opened,setOpened]=useState(false),[checked,setChecked]=useState(false);
 return <><OfferDocument onOpen={()=>setOpened(true)}/>{onAccept&&!accepted&&<div className="offer-consent panel" aria-busy={busy}><p>{reviewCopy[language]}</p><p>{s.prompt}</p><label><input type="checkbox" checked={checked} disabled={busy||!opened} onChange={e=>setChecked(e.target.checked)}/><span>{s.check}</span></label>{!opened&&<small>{s.hint}</small>}{error&&<p className="offer-error" role="alert">{error}</p>}<button className="primary wide" disabled={busy||!opened||!checked} onClick={()=>void onAccept()}>{busy?s.busy:s.accept}</button></div>}</>;
}
export function OfferGate({onAccept,busy,error}:{onAccept:()=>Promise<void>;busy:boolean;error:string}){return <main className="offer-gate"><div className="offer-brand"><ProtectedArt src="/assets/icons/icon-72.png" alt=""/><span>Aether<span>Mind</span></span></div><div className="offer-scroll panel"><OfferReview onAccept={onAccept} busy={busy} error={error}/></div></main>}
