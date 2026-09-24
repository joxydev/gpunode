import {useLanguage,intlLocale,languages,type Language} from './i18n';
import type {Account,JourneyStep} from './api';
import {Icon} from './Icons';
import './profile.css';

const stepIcon:Record<JourneyStep['state'],string>={DONE:'check',CURRENT:'bolt',WAITING:'clock',LOCKED:'lock'};
const stateText:Record<JourneyStep['state'],string>={DONE:'Готово',CURRENT:'Текущий этап',WAITING:'Следующий этап',LOCKED:'После Epoch'};
const requestState:Record<string,string>={REQUESTED:'На рассмотрении',REVIEWED:'В работе',CLOSED:'Закрыта'};
const exactBalance=(value:string,locale:string)=>{const [whole,fraction='']=value.split('.');const significant=fraction.replace(/0+$/,'');return new Intl.NumberFormat(locale).format(BigInt(whole||'0'))+(significant?'.'+significant.padEnd(2,'0'):'')};

type ProfileProps={account:Account;onMarket:()=>void;onFunding:()=>void;onOrder:()=>void;onWithdraw:()=>void;onOffer:()=>void;onReadOrders:()=>void};

export default function Profile({account,onMarket,onFunding,onOrder,onWithdraw,onOffer,onReadOrders}:ProfileProps){
 const {t,language,choose}=useLanguage();
 const locale=intlLocale(language),selected=account.selectedTariff;
 const action=(step:JourneyStep)=>step.id==='TARIFF'?onMarket:step.id==='FUNDED'?onFunding:step.id==='ORDERED'?onOrder:step.id==='WITHDRAW'?onWithdraw:undefined;
 const pending=account.requests.some(request=>request.isTestOrder&&['REQUESTED','REVIEWED'].includes(request.status));

 return <section className="profile-page">
  <header className="profile-heading"><span className="eyebrow">{t('AETHERMIND / ID PROFILE')}</span><h1>{t('Профиль')}</h1><p>{t('Здравствуйте,')} <b>{account.user.name}</b>{t('. Здесь собран ваш путь от регистрации до завершения Epoch.')}</p></header>

  <div className="profile-main">
   <div className="profile-summary">
    <section className="profile-overview" aria-label={t('Профиль')}>
     <article className="profile-balance panel"><div><span>{t('Учётный баланс')}</span><span className="chip">USDT</span></div><strong>{exactBalance(account.balance,locale)}</strong><small>{t(account.paymentsEnabled?'Доступен для подтверждённых операций':'Публичное пополнение и списание ещё не подключены')}</small></article>
     <article className={'profile-tariff panel '+(selected?'selected':'empty')}><span>{t('Выбранный тариф')}</span>{selected?<><h2>{selected.name}</h2><div><b>{Number(selected.depositUsdt).toLocaleString(locale)} USDT</b><small>{selected.days} {t('дней')} · {selected.dailyPercent}% {t('в сутки')}</small></div><button className="text-button" onClick={onMarket}>{t('Изменить до активации')} <Icon name="arrow" size={15}/></button></>:<><h2>{t('Не выбран')}</h2><p>{t('Начните с фиксированной категории по оферте.')}</p><button className="secondary" onClick={onMarket}>{t('Выбрать тариф')}</button></>}</article>
    </section>
    <section className="profile-test panel"><div><span className="eyebrow">{t('ТЕСТОВЫЙ РЕЖИМ')}</span><h2>{t('Тестовый баланс')} · {Math.floor(Number(account.testBalance)).toLocaleString(locale)} USDT</h2><p>{t('Начисляется владельцем для проверки заказа. Не является депозитом и недоступен для вывода.')}</p></div>{selected&&<button className="secondary" disabled={pending} onClick={onOrder}>{pending?t('Заказ на рассмотрении'):t('Проверить и заказать')}</button>}</section>
    {Boolean(account.notifications.unreadOrders)&&<div className="profile-order-notice panel" role="status"><Icon name="bolt" size={20}/><p>{t('По вашему тестовому заказу принято решение. Подробности ниже.')}</p><button className="secondary" onClick={onReadOrders}>{t('Понятно')}</button></div>}
   </div>

   <section className="profile-journey panel" aria-label={t('Этапы участия')}>
    <div className="profile-journey-head"><div><span className="eyebrow">{t('ВАШ ПУТЬ')}</span><h2>{t('Этапы участия')}</h2></div><span>{account.journey.filter(step=>step.state==='DONE').length}/5</span></div>
    <ol className="journey-list">{account.journey.map((step,index)=>{const run=action(step);const expanded=step.state==='CURRENT'||(step.state==='WAITING'&&step.id==='ORDERED'&&pending);return <li className={'journey-step '+step.state.toLowerCase()} aria-current={step.state==='CURRENT'?'step':undefined} key={step.id}><div className="journey-index"><Icon name={stepIcon[step.state]} size={16}/></div><div className="journey-copy"><small>{t('Этап')} {index+1}</small><h3>{t(step.title)}</h3>{expanded&&<p>{t(step.description)}</p>}{step.state==='CURRENT'&&run&&<button className={step.available?'secondary':'ghost'} onClick={run}>{t(step.id==='TARIFF'?'Перейти к тарифам':'Подробнее')} <Icon name="arrow" size={15}/></button>}</div><span className="journey-state">{t(stateText[step.state])}</span></li>})}</ol>
   </section>
  </div>

  <section className="profile-section profile-assets"><div className="section-title"><h2>{t('Мои активы')}</h2><span className="micro">{t('ТЕСТОВЫЙ РЕЖИМ')}</span></div><div className="profile-assets-grid">{account.testAssets.length?account.testAssets.map(asset=><article className="profile-asset panel" key={asset.id}><div className="profile-asset-head"><img src={`${asset.node.imageUrl}/card-320.webp`} alt="" draggable={false} loading="lazy"/><div><span className="chip">{t('Ожидает назначения')}</span><h3>{asset.node.name}</h3><small>{asset.node.chip} · {asset.node.tflopsPower} TFLOPS</small></div></div><p>{t('Заказ одобрен. Оборудование и нагрузка ещё не назначены; телеметрия и начисления не запущены.')}</p><div className="profile-asset-facts"><span>{t('Тестовая стоимость')}: {Math.floor(Number(asset.priceUsdt)).toLocaleString(locale)} USDT</span><span>{t('Плановый срок')}: {asset.termDays} {t('дней')}</span></div></article>):<div className="panel profile-asset-empty"><Icon name="node" size={28}/><p>{t('Здесь появится оборудование после одобрения заказа владельцем.')}</p></div>}</div></section>

  {!!account.activeNodes.length&&<section className="profile-section"><div className="section-title"><h2>{t('Активные тарифы')}</h2><span className="micro">EPOCH</span></div>{account.activeNodes.map(node=><article className="profile-node panel" key={node.id}><span className="chip">{t(node.status)}</span><h3>{node.node.name}</h3><p>{t('Срок до')} {new Date(node.expiresAt).toLocaleDateString(locale)}</p></article>)}</section>}

  <details className="profile-settings panel"><summary>{t('Настройки и документы')} <Icon name="chevron" size={16}/></summary><div className="profile-settings-body"><section className="profile-language"><h2>{t('Язык приложения')}</h2><label htmlFor="profile-language">{t('Выберите язык')}<select id="profile-language" value={language} onChange={event=>choose(event.target.value as Language)}>{languages.map(item=><option key={item.code} value={item.code} lang={item.code}>{item.native}</option>)}</select></label><p>{t('Настройка сохраняется в вашем аккаунте.')}</p></section><section className="profile-legal"><Icon name="shield" size={25}/><div><h3>{t('Оферта №')} {account.offer.number}</h3><p>{t('Акцепт зафиксирован')} {account.offer.acceptedAt?new Date(account.offer.acceptedAt).toLocaleString(locale):'—'}.</p></div><button className="text-button" onClick={onOffer}>{t('Открыть')}</button></section></div></details>

  {!!account.requests.length&&<details className="profile-history panel"><summary>{t('Архив прежних заявок')} <span>{account.requests.length}</span></summary>{account.requests.map(request=><article key={request.id}><div><b>{request.nodeId}</b><span>{t(requestState[request.status]||request.status)}</span></div>{request.isTestOrder&&<p className="test-label">{t('Тестовый заказ')} · {request.testPriceUsdt} USDT</p>}{request.closureReason&&<p>{request.closureReason}</p>}<small>{new Date(request.createdAt).toLocaleDateString(locale)}</small></article>)}</details>}
 </section>;
}
