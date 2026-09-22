import type {Account,JourneyStep} from './api';
import {Icon} from './Icons';
import './profile.css';

const stepIcon:Record<JourneyStep['state'],string>={DONE:'check',CURRENT:'bolt',WAITING:'clock',LOCKED:'lock'};
const stateText:Record<JourneyStep['state'],string>={DONE:'Готово',CURRENT:'Текущий этап',WAITING:'Следующий этап',LOCKED:'После Epoch'};
const requestState:Record<string,string>={REQUESTED:'На рассмотрении',REVIEWED:'В работе',CLOSED:'Закрыта'};

export default function Profile({account,onMarket,onFunding,onOrder,onWithdraw,onOffer}:{account:Account;onMarket:()=>void;onFunding:()=>void;onOrder:()=>void;onWithdraw:()=>void;onOffer:()=>void}){
 const selected=account.selectedTariff;
 const action=(step:JourneyStep)=>step.id==='TARIFF'?onMarket:step.id==='FUNDED'?onFunding:step.id==='ORDERED'?onOrder:step.id==='WITHDRAW'?onWithdraw:undefined;
 return <section className="profile-page">
  <header className="profile-heading"><span className="eyebrow">AETHERMIND / ID PROFILE</span><h1>Профиль</h1><p>Здравствуйте, <b>{account.user.name}</b>. Здесь собран ваш путь от регистрации до завершения Epoch.</p></header>
  <section className="profile-overview">
   <article className="profile-balance panel"><div><span>Учётный баланс</span><span className="chip">USDT</span></div><strong>{Math.floor(Number(account.balance)).toLocaleString('ru-RU')}</strong><small>{account.paymentsEnabled?'Доступен для подтверждённых операций':'Пополнение и списание ещё не подключены'}</small></article>
   <article className={'profile-tariff panel '+(selected?'selected':'empty')}><span>Выбранный тариф</span>{selected?<><h2>{selected.name}</h2><div><b>{Number(selected.depositUsdt).toLocaleString('ru-RU')} USDT</b><small>{selected.days} дней · {selected.dailyPercent}% в сутки</small></div><button className="text-button" onClick={onMarket}>Изменить до активации <Icon name="arrow" size={15}/></button></>:<><h2>Не выбран</h2><p>Начните с фиксированной категории по оферте.</p><button className="secondary" onClick={onMarket}>Выбрать тариф</button></>}</article>
  </section>
  <section className="profile-journey panel"><div className="profile-journey-head"><div><span className="eyebrow">ВАШ ПУТЬ</span><h2>Этапы участия</h2></div><span>{account.journey.filter(s=>s.state==='DONE').length}/5</span></div><div className="journey-list">{account.journey.map((step,index)=>{const run=action(step);return <article className={'journey-step '+step.state.toLowerCase()} key={step.id}><div className="journey-index"><Icon name={stepIcon[step.state]} size={18}/><i/></div><div className="journey-copy"><div><small>Этап {index+1}</small><span>{stateText[step.state]}</span></div><h3>{step.title}</h3><p>{step.description}</p>{step.state==='CURRENT'&&run&&<button className={step.available?'secondary':'ghost'} onClick={run}>{step.id==='TARIFF'?'Перейти к тарифам':'Подробнее'} <Icon name="arrow" size={15}/></button>}</div></article>})}</div></section>
  <section className="profile-legal panel"><Icon name="shield" size={25}/><div><h3>Оферта № {account.offer.number}</h3><p>Акцепт зафиксирован {account.offer.acceptedAt?new Date(account.offer.acceptedAt).toLocaleString('ru-RU'):'—'}.</p></div><button className="text-button" onClick={onOffer}>Открыть</button></section>
  {!!account.activeNodes.length&&<section className="profile-section"><div className="section-title"><h2>Активные тарифы</h2><span className="micro">EPOCH</span></div>{account.activeNodes.map(node=><article className="profile-node panel" key={node.id}><span className="chip">{node.status}</span><h3>{node.node.name}</h3><p>Срок до {new Date(node.expiresAt).toLocaleDateString('ru-RU')}</p></article>)}</section>}
  {!!account.requests.length&&<details className="profile-history panel"><summary>Архив прежних заявок <span>{account.requests.length}</span></summary>{account.requests.map(r=><article key={r.id}><div><b>{r.nodeId}</b><span>{requestState[r.status]||r.status}</span></div>{r.closureReason&&<p>{r.closureReason}</p>}<small>{new Date(r.createdAt).toLocaleDateString('ru-RU')}</small></article>)}</details>}
 </section>
}
