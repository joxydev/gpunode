import {useLanguage,type Language} from './i18n';
import {useState} from 'react';
import {Icon} from './Icons';
import './offer.css';

export const OFFER_VERSION='88-2026-AI-2026-09-30';
export const OFFER_DOCUMENT_SHA256='0c8e7036a52be9d1ff415a5a44f76743246e032aff0fe14300fa11f973e1a8eb';
const PDF='/documents/public-offer-aethermind.pdf';
const OLD='/documents/public-offer-aethermind-2026-09-21.pdf';
const copy:Record<Language,{date:string;intro:string;net:string;withdraw:string;early:string;paused:string;open:string;old:string;prompt:string;check:string;accept:string;busy:string;hint:string}>={
 ru:{date:'Редакция от 30 сентября 2026 г. · 6 страниц',intro:'Полный русский текст в PDF является источником условий. Это краткое описание его не заменяет.',net:'Пункт 5.1: USDT только в TRC-20 и BEP-20; новые TON-пополнения приостановлены.',withdraw:'Пункт 5.3: вывод прибыли от 10 USDT, комиссия платформы 0%, заявленный срок обработки 15 минут — 24 часа.',early:'Пункты 5.4–5.5: Compound Boost выбирается отдельно и исключает досрочный вывод. Без него комиссия с депозита: дни 1–14 — 15%, 15–29 — 7%, 30–59 для Beta/POD — 3%, 60–89 для POD — 1,5%; после Epoch — 0%.',paused:'Заказы и начисления приостановлены. Ранее зачисленные средства и история остаются в профиле.',open:'Открыть полный PDF',old:'Предыдущая редакция для старых договоров',prompt:'Откройте полный PDF и прочитайте документ до принятия.',check:'Я открыл(а), прочитал(а) и принимаю редакцию от 30.09.2026.',accept:'Принять новую редакцию',busy:'Фиксируем акцепт…',hint:'Сначала откройте PDF и отметьте согласие.'},
 en:{date:'Edition dated 30 September 2026 · 6 pages',intro:'The full Russian PDF is the authoritative text. This summary does not replace it.',net:'Clause 5.1: USDT only on TRC-20 and BEP-20; new TON deposits are paused.',withdraw:'Clause 5.3: profit withdrawals from 10 USDT, 0% platform fee, stated processing time 15 minutes to 24 hours.',early:'Clauses 5.4–5.5: Compound Boost is optional and excludes early withdrawal. Base principal fee: days 1–14: 15%, 15–29: 7%, Beta/POD days 30–59: 3%, POD days 60–89: 1.5%; 0% after the Epoch.',paused:'Orders and accruals are paused. Previously credited funds and history remain in the profile.',open:'Open the full PDF',old:'Previous edition for existing contracts',prompt:'Open and read the full PDF before accepting.',check:'I opened, read and accept the edition dated 30 September 2026.',accept:'Accept the new edition',busy:'Recording acceptance…',hint:'Open the PDF first and then check the consent box.'},
 ro:{date:'Ediția din 30 septembrie 2026 · 6 pagini',intro:'Textul complet în rusă din PDF este sursa condițiilor. Rezumatul nu îl înlocuiește.',net:'Clauza 5.1: USDT numai în TRC-20 și BEP-20; depunerile noi prin TON sunt suspendate.',withdraw:'Clauza 5.3: retragerea profitului de la 10 USDT, comisionul platformei 0%, termenul indicat 15 minute–24 ore.',early:'Clauzele 5.4–5.5: Compound Boost se alege separat și exclude retragerea anticipată. Taxa din depozitul Base: zilele 1–14: 15%, 15–29: 7%, Beta/POD 30–59: 3%, POD 60–89: 1,5%; 0% după Epoch.',paused:'Comenzile și acumulările sunt suspendate. Fondurile creditate anterior și istoricul rămân în profil.',open:'Deschide PDF-ul complet',old:'Ediția anterioară pentru contractele existente',prompt:'Deschide și citește PDF-ul complet înainte de acceptare.',check:'Am deschis, citit și accept ediția din 30.09.2026.',accept:'Acceptă ediția nouă',busy:'Înregistrăm acceptarea…',hint:'Deschide mai întâi PDF-ul și apoi bifează acordul.'}
};
const rows=[['Node Alpha','50',30,'1.5%','1.8%'],['Cluster Beta','300',60,'2.5%','3.0%'],['Enterprise POD','1 200',90,'3.5%','4.2%'],['Quantum Array','5 000',180,'—','—']] as const;
export function OfferDocument({onOpen}:{onOpen?:()=>void}){
 const {language}=useLanguage(),s=copy[language];
 return <article className="offer-copy" lang={language}>
  <header><span className="eyebrow">AETHERMIND / PUBLIC OFFER</span><h1>№ 88/2026-AI</h1><small>{s.date}</small></header>
  <p className="offer-note">{s.intro}</p>
  <div className="offer-rate-list">{rows.map(([name,price,days,base,boost])=><article className="offer-rate" key={name}><h3>{name} · {price} USDT</h3><p>Epoch {days} · Base {base} · Boost {boost}</p></article>)}</div>
  <p>{s.net}</p><p>{s.withdraw}</p><p>{s.early}</p><p className="offer-note">{s.paused}</p>
  <a className="offer-download" href={PDF} target="_blank" rel="noopener noreferrer" onClick={onOpen}><Icon name="arrow" size={18}/>{s.open}</a>
  <a href={OLD} target="_blank" rel="noopener noreferrer">{s.old}</a>
 </article>;
}
export function OfferGate({onAccept,busy,error}:{onAccept:()=>Promise<void>;busy:boolean;error:string}){
 const {language}=useLanguage(),s=copy[language];
 const [opened,setOpened]=useState(false),[checked,setChecked]=useState(false),[hint,setHint]=useState('');
 return <main className="offer-gate">
  <div className="offer-brand"><img src="/assets/icons/icon-72.png" alt=""/><span>Aether<span>Mind</span></span></div>
  <div className="offer-scroll panel" tabIndex={0} aria-label={s.prompt}><OfferDocument onOpen={()=>{setOpened(true);setHint('')}}/></div>
  <div className="offer-consent panel"><p>{s.prompt}</p><label><input type="checkbox" checked={checked} disabled={busy||!opened} onChange={e=>{setChecked(e.target.checked);setHint('')}}/><span>{s.check}</span></label>
   {hint&&<p className="offer-hint" role="alert">{hint}</p>}{error&&<p className="offer-error" role="alert">{error}</p>}
   <button className="primary wide" disabled={busy||!opened||!checked} onClick={()=>{if(opened&&checked)void onAccept();else setHint(s.hint)}}>{busy?s.busy:s.accept}</button>
  </div>
 </main>;
}
