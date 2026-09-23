import {useLanguage,intlLocale,languages,type Language} from './i18n';
import type {Account,JourneyStep} from './api';
import {Icon} from './Icons';
import './profile.css';

const stepIcon:Record<JourneyStep['state'],string>={DONE:'check',CURRENT:'bolt',WAITING:'clock',LOCKED:'lock'};
const stateText:Record<JourneyStep['state'],string>={DONE:'Готово',CURRENT:'Текущий этап',WAITING:'Следующий этап',LOCKED:'После Epoch'};
const requestState:Record<string,string>={REQUESTED:'На рассмотрении',REVIEWED:'В работе',CLOSED:'Закрыта'};

export default function Profile({account,onMarket,onFunding,onOrder,onWithdraw,onOffer}:{account:Account;onMarket:()=>void;onFunding:()=>void;onOrder:()=>void;onWithdraw:()=>void;onOffer:()=>void}){
 const {t,language,choose}=useLanguage();
 const selected=account.selectedTariff;
 const action=(step:JourneyStep)=>step.id==='TARIFF'?onMarket:step.id==='FUNDED'?onFunding:step.id==='ORDERED'?onOrder:step.id==='WITHDRAW'?onWithdraw:undefined;
 return <section className="profile-page">
  <header className="profile-heading"><span className="eyebrow">{t("AETHERMIND / ID PROFILE")}</span><h1>{t("Профиль")}</h1><p>{t("Здравствуйте,")} <b>{account.user.name}</b>{t(". Здесь собран ваш путь от регистрации до завершения Epoch.")}</p></header>
  <section className="profile-overview">
   <article className="profile-balance panel"><div><span>{t("Учётный баланс")}</span><span className="chip">USDT</span></div><strong>{Math.floor(Number(account.balance)).toLocaleString(intlLocale(language))}</strong><small>{t(account.paymentsEnabled?'Доступен для подтверждённых операций':'Пополнение и списание ещё не подключены')}</small></article>
   <article className={'profile-tariff panel '+(selected?'selected':'empty')}><span>{t("Выбранный тариф")}</span>{selected?<><h2>{selected.name}</h2><div><b>{Number(selected.depositUsdt).toLocaleString(intlLocale(language))} USDT</b><small>{selected.days} {t("дней")} · {selected.dailyPercent}% {t("в сутки")}</small></div><button className="text-button" onClick={onMarket}>{t("Изменить до активации")} <Icon name="arrow" size={15}/></button></>:<><h2>{t("Не выбран")}</h2><p>{t("Начните с фиксированной категории по оферте.")}</p><button className="secondary" onClick={onMarket}>{t("Выбрать тариф")}</button></>}</article>
  </section>
  <section className="profile-journey panel"><div className="profile-journey-head"><div><span className="eyebrow">{t("ВАШ ПУТЬ")}</span><h2>{t("Этапы участия")}</h2></div><span>{account.journey.filter(s=>s.state==='DONE').length}/5</span></div><div className="journey-list">{account.journey.map((step,index)=>{const run=action(step);return <article className={'journey-step '+step.state.toLowerCase()} key={step.id}><div className="journey-index"><Icon name={stepIcon[step.state]} size={18}/><i/></div><div className="journey-copy"><div><small>{t("Этап")} {index+1}</small><span>{t(stateText[step.state])}</span></div><h3>{t(step.title)}</h3><p>{t(step.description)}</p>{step.state==='CURRENT'&&run&&<button className={step.available?'secondary':'ghost'} onClick={run}>{t(step.id==='TARIFF'?'Перейти к тарифам':'Подробнее')} <Icon name="arrow" size={15}/></button>}</div></article>})}</div></section>
  <section className="profile-language panel"><h2>{t("Язык приложения")}</h2><label htmlFor="profile-language">{t("Выберите язык")}<select id="profile-language" value={language} onChange={event=>choose(event.target.value as Language)}>{languages.map(item=><option key={item.code} value={item.code} lang={item.code}>{item.native}</option>)}</select></label><p>{t("Настройка сохраняется в вашем аккаунте.")}</p></section>
  <section className="profile-legal panel"><Icon name="shield" size={25}/><div><h3>{t("Оферта №")} {account.offer.number}</h3><p>{t("Акцепт зафиксирован")} {account.offer.acceptedAt?new Date(account.offer.acceptedAt).toLocaleString(intlLocale(language)):'—'}.</p></div><button className="text-button" onClick={onOffer}>{t("Открыть")}</button></section>
  {!!account.activeNodes.length&&<section className="profile-section"><div className="section-title"><h2>{t("Активные тарифы")}</h2><span className="micro">EPOCH</span></div>{account.activeNodes.map(node=><article className="profile-node panel" key={node.id}><span className="chip">{t(node.status)}</span><h3>{node.node.name}</h3><p>{t("Срок до")} {new Date(node.expiresAt).toLocaleDateString(intlLocale(language))}</p></article>)}</section>}
  {!!account.requests.length&&<details className="profile-history panel"><summary>{t("Архив прежних заявок")} <span>{account.requests.length}</span></summary>{account.requests.map(r=><article key={r.id}><div><b>{r.nodeId}</b><span>{t(requestState[r.status]||r.status)}</span></div>{r.closureReason&&<p>{r.closureReason}</p>}<small>{new Date(r.createdAt).toLocaleDateString(intlLocale(language))}</small></article>)}</details>}
 </section>
}
