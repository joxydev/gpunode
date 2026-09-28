import {useEffect,useState} from 'react';
import {api,type Account,type JourneyStep} from './api';
import {Icon} from './Icons';
import {useLanguage,intlLocale} from './i18n';
import {epochDays} from './Assets';
import {displayBalance} from './dashboard-model';
import {activityLabels,statusLabels,type ActivityItem} from './production-types';
import './dashboard.css';

const icon:Record<JourneyStep['state'],string>={DONE:'check',CURRENT:'bolt',WAITING:'clock',LOCKED:'lock'};
const stateLabel:Record<JourneyStep['state'],string>={DONE:'Готово',CURRENT:'Текущий этап',WAITING:'Следующий этап',LOCKED:'После Epoch'};

export default function Dashboard({account,onMarket,onFinance,onHistory,onAssets,onWithdraw,onOrder,onSupport}:{account:Account;onMarket:()=>void;onFinance:()=>void;onHistory:()=>void;onAssets:()=>void;onWithdraw:()=>void;onOrder:()=>void;onSupport:()=>void}){
 const {t,language}=useLanguage(),locale=intlLocale(language),[activity,setActivity]=useState<ActivityItem[]|null>(null);
 useEffect(()=>{let active=true;void api<{items:ActivityItem[]}>('/v1/activity').then(data=>{if(active)setActivity(data.items.slice(0,5))}).catch(()=>{if(active)setActivity(previous=>previous||[])});return()=>{active=false}},[account.user.id,account.updatedAt]);
 const action=account.nextAction;
 const actionMap:Record<typeof action.kind,{text:string;button:string;run:()=>void}>={
  SELECT_TARIFF:{text:'Выберите тариф, чтобы продолжить.',button:'Открыть тарифы',run:onMarket},
  ADD_FUNDS:{text:'Пополните баланс для выбранного тарифа.',button:'Пополнить',run:onFinance},
  REQUEST_PENDING:{text:'Заявка рассматривается оператором.',button:'Поддержка',run:onSupport},
  PROVISIONING:{text:'Оборудование назначается оператором.',button:'Мои ноды',run:onAssets},
  EPOCH_ACTIVE:{text:'Epoch активен.',button:'Мои ноды',run:onAssets},
  WITHDRAW_MANUAL:{text:'Epoch завершён. Запрос на вывод рассматривается вручную.',button:'О выводе',run:onWithdraw},
  ORDER_UNAVAILABLE:{text:'Тариф выбран. Оформление заказа подключается отдельно; баланс не списывается.',button:'Подробнее',run:onOrder}
 };
 const next=actionMap[action.kind];
 const active=account.activeNodes.filter(node=>['ACTIVE','OVERCLOCKED'].includes(node.status)&&Date.parse(node.expiresAt)>Date.now());
 return <section className="dashboard-page" aria-labelledby="dashboard-heading">
  <header className="dashboard-heading"><span className="eyebrow">AETHERMIND / DASHBOARD</span><h1 id="dashboard-heading">{t('Главная')}</h1></header>
  <article className="panel dashboard-hero"><div><span>{t('Здравствуйте,')} {account.user.name}</span><p>{t('Общий баланс')}</p><strong>{displayBalance(account.balance,locale)} <small>USDT</small></strong></div><div className="dashboard-actions"><button className="primary" onClick={onFinance}>{t('Пополнить')}</button><button className="secondary" onClick={onWithdraw}>{t('Вывести')}</button></div></article>
  <article className="panel next-action" aria-live="polite"><div><span className="eyebrow">{t('Следующее действие')}</span><h2>{t(next.text)}</h2>{action.kind==='ADD_FUNDS'&&<p>{action.tariff}: {t('необходимо')} {displayBalance(action.required||'0',locale)} USDT · {t('Баланс')} {displayBalance(account.balance,locale)} USDT · {t('Не хватает')} {displayBalance(action.missing||'0',locale)} USDT</p>}</div><button className="secondary" onClick={next.run}>{t(next.button)} <Icon name="arrow" size={17}/></button></article>
  <div className="dashboard-grid">
   <section className="panel dashboard-journey"><div className="section-title"><h2>{t('Этапы участия')}</h2><span>{account.journey.filter(s=>s.state==='DONE').length}/{account.journey.length}</span></div>{active.length?<details><summary>{t('Показать путь участия')}</summary><Journey steps={account.journey}/></details>:<Journey steps={account.journey}/>}</section>
   <section className="panel dashboard-assets"><div className="section-title"><h2>{t('Мои ноды')}</h2><button className="text-button" onClick={onAssets}>{t('Открыть')} <Icon name="arrow" size={16}/></button></div>{active.length?active.slice(0,2).map(node=>{const days=epochDays(node);return <div className="dashboard-node" key={node.id}><b>{node.node.name}</b><span className="chip">{t(node.status)}</span><p>Epoch {days?`${days.current} / ${days.total}`:'—'} · {t('До завершения')} {days?.remaining ?? '—'} {t('дней')}</p><small>{t('Начало')}: {new Date(node.createdAt).toLocaleDateString(locale)} · {t('Завершение')}: {new Date(node.expiresAt).toLocaleDateString(locale)}</small></div>}):<div className="dashboard-empty"><p>{t('Активных нод пока нет')}</p><button className="secondary" onClick={onMarket}>{t('Открыть тарифы')}</button></div>}</section>
  </div>
  <section className="panel dashboard-activity"><div className="section-title"><h2>{t('Последние действия')}</h2><button className="text-button" onClick={onHistory}>{t('Все операции')} <Icon name="arrow" size={16}/></button></div>{activity===null?<div className="activity-skeleton" role="status" aria-label={t('Загрузка…')}><i/><i/><i/></div>:activity.length?activity.map(row=><div className="activity-row" key={row.id}><div><b>{t(activityLabels[row.type]||row.type)}</b><small>{t(statusLabels[row.status]||row.status)} · {new Date(row.createdAt).toLocaleString(locale)}</small></div><span>{row.amount?row.amount+' USDT':'—'}</span></div>):<div className="dashboard-empty"><p>{t('Операций пока нет')}</p><button className="secondary" onClick={onFinance}>{t('Открыть финансы')}</button></div>}</section>
 </section>;
}

function Journey({steps}:{steps:JourneyStep[]}){const {t}=useLanguage();return <ol className="dashboard-steps">{steps.map((step,index)=><li key={step.id} className={step.state.toLowerCase()} aria-current={step.state==='CURRENT'?'step':undefined}><span className="journey-index"><Icon name={icon[step.state]} size={16}/></span><div><small>{t('Этап')} {index+1} · {t(stateLabel[step.state])}</small><b>{t(step.title)}</b>{step.state==='CURRENT'&&<p>{t(step.description)}</p>}</div></li>)}</ol>}
