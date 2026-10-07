import {useEffect,useState} from 'react';
import {api,type Account} from './api';
import {Icon} from './Icons';
import {useLanguage,intlLocale} from './i18n';
import {epochDays} from './Assets';
import {displayBalance} from './dashboard-model';
import {statusLabels} from './production-types';
import './dashboard.css';

export type MarketNode={id:string;name:string;priceUsdt:string;contractDays:number;availability:'AVAILABLE'|'SOLD_OUT'|'UNCONFIGURED'|'PAUSED'|'CONCEPT';canBuy:boolean;canSelect:boolean;experimental:boolean;image:string};
type Props={account:Account|null;onMarket:()=>void;onFinance:()=>void;onAssets:()=>void;onWithdraw:()=>void;onOrder:()=>void;onSupport:()=>void;onTour:()=>void;onLogin:()=>void;onOffer:()=>void};
const date=(value:string,locale:string)=>new Date(value).toLocaleDateString(locale);

export default function Dashboard({account,onMarket,onFinance,onAssets,onWithdraw,onOrder,onSupport,onTour,onLogin,onOffer}:Props){
 const {t,language}=useLanguage(),locale=intlLocale(language);
 const [nodes,setNodes]=useState<MarketNode[]>([]),[problem,setProblem]=useState('');
 const catalogueKey=(account?.activeNodes||[]).map(node=>node.id+':'+node.status).sort().join('|');
 useEffect(()=>{let live=true;void api<{nodes:MarketNode[]}>('/v1/market').then(data=>{if(live)setNodes(data.nodes)}).catch(e=>{if(live)setProblem((e as Error).message)});return()=>{live=false}},[account?.selectedTariff?.nodeId,catalogueKey]);
 const selected=nodes.find(n=>n.id===account?.selectedTariff?.nodeId),leased=account?.activeNodes||[];
 const provisioning=leased.filter(n=>n.status==='PROVISIONING');
 const active=leased.filter(n=>['ACTIVE','OVERCLOCKED'].includes(n.status));
 const completed=leased.filter(n=>['COMPLETED','EARLY_UNBONDED','EXPIRED'].includes(n.status));
 const featured=provisioning[0]||active[0]||completed[0];
 const action=account?.nextAction;
 const next:Record<NonNullable<typeof action>['kind'],{text:string;button:string;run:()=>void}>={
  SELECT_TARIFF:{text:'Выберите тариф, чтобы оформить первую ноду.',button:'Выбрать тариф',run:onMarket},
  ADD_FUNDS:{text:'Для выбранного тарифа не хватает средств на доступном балансе.',button:`${t('Пополнить на')} ${displayBalance(action?.missing||'0',locale)} USDT`,run:onFinance},
  REQUEST_PENDING:{text:'Заявка рассматривается оператором.',button:'Мои ноды',run:onAssets},
  PROVISIONING:{text:'Заказ оплачен. Сервис назначает оборудование.',button:'Открыть мою ноду',run:onAssets},
  EPOCH_ACTIVE:{text:'Оборудование работает. Следите за сроком и начислениями в кабинете.',button:'Открыть мою ноду',run:onAssets},
  WITHDRAW_MANUAL:{text:'После завершения срока проверьте состояние ноды.',button:'Мои ноды',run:onAssets},
  ORDER_UNAVAILABLE:{text:'Заказ сейчас недоступен. Выбранный тариф сохранён.',button:'Открыть тарифы',run:onMarket},
  ORDER_SOLD_OUT:{text:'Для выбранной категории нет подтверждённых свободных слотов.',button:'Сравнить тарифы',run:onMarket},
  ORDER_READY:{text:'Баланс достаточен. Проверьте условия перед заказом.',button:'Заказать ноду',run:onOrder},
  CURRENT_OFFER_REQUIRED:{text:'Примите актуальную редакцию оферты перед заказом.',button:'Открыть условия',run:onOrder},
  EPOCH_COMPLETED:{text:'Срок работы завершён. Результат и доступный баланс видны в кабинете.',button:'Мои ноды',run:onAssets}
 };
 const current=action?next[action.kind]:null;
 const heroAction=featured?{label:'Открыть мою ноду',run:onAssets}:action?.kind==='ORDER_READY'?{label:'Заказать ноду',run:onOrder}:action?.kind==='ADD_FUNDS'?{label:next.ADD_FUNDS.button,run:onFinance}:{label:'Выбрать тариф',run:onMarket};
 const steps:[string,string,()=>void][]=[
  ['Выберите тариф и изучите условия.','Срок, депозит и расчёт показаны до подтверждения.',onMarket],
  ['Подключите TON-кошелёк и пополните баланс USDT.','Сумма появляется после проверки перевода.',account?onFinance:onLogin],
  ['Подтвердите заказ ноды.','Выбор тарифа сам по себе не списывает баланс.',account?onOrder:onLogin],
  ['Получайте начисления после активации.','Оборудование выполняет работу. Начисления зависят от условий тарифа.',account?onAssets:onTour],
  ['Выводите доступные средства.','Проверьте сумму, адрес и комиссии перед заявкой.',account?onWithdraw:onLogin]
 ];
 const stepIndex=completed.length&&!active.length&&!provisioning.length?4:provisioning.length||active.length?3:account?.selectedTariff?account.nextAction.kind==='ADD_FUNDS'?1:2:0;
 // The answers refer to the published offer and existing withdrawal flow, not estimated rates.
 const answers:[string,string,()=>void][]=[
  ['Что такое нода?','Нода — назначаемое оператором оборудование в GPU-инфраструктуре. GPU — вычислительный процессор для задач обработки данных.',onMarket],
  ['Когда начинаются начисления?','Начисления начинаются только после активации оборудования. Срок и порядок расчёта зависят от выбранного тарифа и доступны в карточке ноды.',account?onAssets:onTour],
  ['В какой сети пополнять USDT?','Для пополнения используется только USDT в сети TON и счёт, созданный в приложении.',onFinance],
  ['Что происходит после заказа?','После заказа сервис назначает и активирует оборудование. Оборудование начинает выполнять вычислительные задачи, а вы начинаете получать начисления по условиям выбранного тарифа. Состояние оборудования и начисления доступны в личном кабинете.',account?onAssets:onTour],
  ['Где правила вывода и досрочного завершения?','Откройте условия в оферте и актуальный расчёт в окне вывода или карточке ноды.',onWithdraw],
  ['Как получить помощь?','Напишите в поддержку из кабинета; обращение сохраняется в профиле.',onSupport]
 ];
 const myNodes=<section className="panel dashboard-my-nodes" data-tour="nodes"><div className="section-title"><h2>{t('Мои ноды')}</h2>{account&&<button className="text-button" onClick={onAssets}>{t('Открыть')} <Icon name="arrow" size={16}/></button>}</div>{!account?<p>{t('Войдите через Telegram, чтобы увидеть свои заказы и начисления.')}</p>:!provisioning.length&&!active.length&&!completed.length?<div className="dashboard-empty"><p>{t('Выберите тариф, чтобы оформить первую ноду.')}</p><button className="secondary" onClick={onMarket}>{t('Выбрать тариф')}</button></div>:<div className="dashboard-node-grid">{[...provisioning,...active,...completed.slice(0,1)].slice(0,4).map(node=>{const days=epochDays(node);return <article className="dashboard-node" key={node.id}><span className="chip">{t(statusLabels[node.status]||node.status)}</span><h3>{node.node?.name||node.nodeId}</h3><p>{node.status==='PROVISIONING'?`${t('Заказ')}: ${date(node.createdAt,locale)} · ${t('Далее — назначение и активация')}`:`${t('Режим')}: ${node.mode||'—'} · ${t('Срок работы')} ${days?`${days.current}/${days.total}`:'—'}`}</p>{node.activatedAt&&<small>{t('Активация')}: {date(node.activatedAt,locale)} · {t('Завершение')}: {node.epochEndsAt?date(node.epochEndsAt,locale):'—'}</small>}{days&&<progress value={days.total-days.remaining} max={days.total} aria-label={t('Прогресс работы')}/>}<button className="text-button" onClick={onAssets}>{t('Подробнее')} <Icon name="arrow" size={15}/></button></article>})}</div>}</section>;
 return <section className={`dashboard-page ${featured?'has-node':''}`} aria-labelledby="dashboard-heading">
  <header className="dashboard-heading"><span className="eyebrow">AETHERMIND / GPU NETWORK</span><h1 id="dashboard-heading">{t('Главная')}</h1></header>
  <section className="dashboard-intro" aria-labelledby="intro-title" data-tour="intro"><div className="dashboard-intro-copy"><span className="eyebrow">{featured?t('ВАШ ТЕКУЩИЙ ЭТАП'):t('ПУТЬ УЧАСТНИКА')}</span><h2 id="intro-title">{t(featured?provisioning.length?'Ваш заказ ожидает назначения':active.length?'Моя нода работает':'Срок работы завершён':'Оборудование работает — вы получаете начисления')}</h2><p>{t(featured?provisioning.length?'Заказ подтверждён. Сервис назначает оборудование. Начисления начнутся после его активации по условиям тарифа.':active.length?'Оборудование выполняет вычислительные задачи. Срок работы, начисления и доступный баланс видны в личном кабинете.':'Срок работы завершён. Откройте ноду, чтобы увидеть итог и доступные действия.':'Выберите тариф, пополните счёт USDT в сети TON и оформите заказ. Сервис назначит и активирует оборудование. Оно начнёт выполнять вычислительные задачи, а вы — получать начисления по условиям тарифа. Следить за прибылью и управлять средствами можно в личном кабинете.')}</p><p className="dashboard-glossary">{t('Нода — оборудование для вычислений. Его срок работы начинается после активации.')}</p><div className="dashboard-hero-buttons"><button className="primary" onClick={heroAction.run}>{t(heroAction.label)} <Icon name="arrow" size={17}/></button><button className="secondary" onClick={onTour}>{t('Как это работает')}</button></div><ul className="dashboard-facts"><li>USDT · TON</li><li>{t('Условия по оферте')}</li><li>{t('Статусы и операции в кабинете')}</li></ul></div></section>
  {problem&&<p role="status" className="dashboard-problem">{problem}</p>}
  {account&&<section className="dashboard-overview" aria-label={t('Личный обзор')} data-tour="account"><div className="panel"><span>{t('Доступный баланс')}</span><strong>{displayBalance(account.balance,locale)} <small>USDT</small></strong><button className="text-button" onClick={onFinance}>{t('Пополнить')} <Icon name="arrow" size={16}/></button></div><div className="panel"><span>{t('Выбранный тариф')}</span><strong>{account.selectedTariff?.name||t('Не выбран')}</strong><small>{account.selectedTariff?`${account.selectedTariff.depositUsdt} USDT · ${account.selectedTariff.days} ${t('дней')}`:t('Выберите категорию для первой ноды')}</small></div><div className="panel"><span>{t('Мои ноды')}</span><strong>{active.length} {t('активных')} · {provisioning.length} {t('ожидают')}</strong><small>{t('В режиме Base')}: {account.lockedBase} USDT · {t('В режиме Compound')}: {account.lockedCompound} USDT</small></div></section>}
  {account&&current&&<aside className="panel next-action" aria-live="polite"><div><span className="eyebrow">{t('Следующее действие')}</span><h2>{t(current.text)}</h2>{action?.kind==='ADD_FUNDS'&&<p>{action.tariff} · {t('Стоимость')}: {displayBalance(action.required||'0',locale)} USDT · {t('Не хватает')}: {displayBalance(action.missing||'0',locale)} USDT</p>}</div><button className="secondary" onClick={current.run}>{t(current.button)} <Icon name="arrow" size={17}/></button></aside>}
  {featured&&myNodes}
  <section className="panel dashboard-start" data-tour="journey"><div className="section-title"><div><span className="eyebrow">01 / {t('МАРШРУТ')}</span><h2>{t('Как начать')}</h2></div><button className="text-button" onClick={onTour}>{t('Посмотреть демонстрацию')} <Icon name="arrow" size={16}/></button></div><ol>{steps.map(([title,description,run],index)=><li key={index} className={account&&index===stepIndex?'current':''} aria-current={account&&index===stepIndex?'step':undefined}><span className="dashboard-step-number">0{index+1}</span><div><h3>{t(title)}</h3><p>{t(description)}</p></div><button className="text-button" onClick={run}>{t('Перейти')} <Icon name="arrow" size={15}/></button></li>)}</ol></section>
  <section className="dashboard-tariffs" data-tour="tariffs"><div className="section-title"><div><span className="eyebrow">02 / {t('УСЛОВИЯ')}</span><h2>{t('Выберите категорию')}</h2></div><button className="text-button" onClick={onMarket}>{t('Все тарифы')} <Icon name="arrow" size={16}/></button></div><div className="dashboard-tariff-grid">{nodes.filter(n=>!n.experimental).slice(0,3).map(n=><article className="panel" key={n.id}><span className="eyebrow">{n.name}</span><strong>{displayBalance(n.priceUsdt,locale)} <small>USDT</small></strong><p>{t('Срок работы')}: {n.contractDays} {t('дней')}</p><small>{t(n.availability==='AVAILABLE'?'Можно заказать':n.availability==='SOLD_OUT'?'Нет свободных слотов':n.availability==='UNCONFIGURED'?'Слоты не подтверждены':'Можно выбрать')}</small><button className="secondary" onClick={onMarket}>{t('Посмотреть условия')}</button></article>)}{!nodes.length&&<p>{t('Параметры тарифов загружаются из каталога.')}</p>}</div></section>
  {!featured&&myNodes}

  <section className="dashboard-platform"><div className="section-title"><div><span className="eyebrow">03 / {t('ПЛАТФОРМА')}</span><h2>{t('Что делает AetherMind')}</h2></div></div><div className="dashboard-platform-grid"><article className="panel"><Icon name="node"/><h3>{t('Оборудование')}</h3><p>{t('Сервис назначает и активирует оборудование. Оно выполняет вычислительные задачи по условиям тарифа.')}</p></article><article className="panel"><Icon name="wallet"/><h3>{t('Учёт операций')}</h3><p>{t('Баланс и операции отражаются в кабинете после проверки и записи на сервере.')}</p></article><article className="panel"><Icon name="help"/><h3>{t('Сопровождение')}</h3><p>{t('Поддержка помогает с пополнениями, заказами, нодами и выводом.')}</p></article></div></section>
  <section className="panel dashboard-faq" data-tour="help"><div className="section-title"><h2>{t('Вопросы и помощь')}</h2><button className="text-button" onClick={onSupport}>{t('Поддержка')} <Icon name="arrow" size={16}/></button></div><div>{answers.map(([question,answer,run])=><details key={question}><summary>{t(question)}</summary><p>{t(answer)}</p><button className="text-button" onClick={run}>{t(question.startsWith('Где')?'Открыть окно вывода':'Подробнее')} <Icon name="arrow" size={15}/></button></details>)}</div><button className="text-button" onClick={onTour}>{t('Посмотреть демонстрацию')}</button><button className="text-button" onClick={onOffer}>{t('Публичная оферта')}</button></section>
 </section>;
}
