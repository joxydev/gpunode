import {useEffect,useState} from 'react';
import {api,type Account} from './api';
import {Icon} from './Icons';
import {useLanguage,intlLocale} from './i18n';
import {GpuSummary} from './GpuLive';
import {exactMoney} from './exact-money';
import {PageHeader,Section,QuickAction,ListRow,StatusPill,Money,EmptyState} from './UI';
import {statusLabels} from './production-types';
import './dashboard.css';

export type MarketNode={id:string;name:string;priceUsdt:string;contractDays:number;availability:'AVAILABLE'|'SOLD_OUT'|'UNCONFIGURED'|'PAUSED'|'CONCEPT';canBuy:boolean;canSelect:boolean;experimental:boolean;image:string};
type Props={account:Account|null;onMarket:()=>void;onFinance:()=>void;onAssets:(leaseId?:string)=>void;onRefresh:()=>Promise<void>;onWithdraw:()=>void;onOrder:()=>void;onSupport:()=>void;onTour:()=>void;onLogin:()=>void;onOffer:()=>void};
const date=(value:string,locale:string)=>new Date(value).toLocaleDateString(locale);

export default function Dashboard({account,onMarket,onFinance,onAssets,onWithdraw,onOrder,onSupport,onTour,onLogin,onOffer,onRefresh}:Props){
 const {t,language}=useLanguage(),locale=intlLocale(language);
 const [nodes,setNodes]=useState<MarketNode[]>([]),[problem,setProblem]=useState(''),[retry,setRetry]=useState(0);
 const catalogueKey=(account?.activeNodes||[]).map(node=>node.id+':'+node.status).sort().join('|');
 useEffect(()=>{let live=true;setProblem('');void api<{nodes:MarketNode[]}>('/v1/market').then(data=>{if(live)setNodes(data.nodes)}).catch(e=>{if(live)setProblem((e as Error).message)});return()=>{live=false}},[account?.selectedTariff?.nodeId,catalogueKey,retry]);
 const selected=nodes.find(n=>n.id===account?.selectedTariff?.nodeId),leased=account?.activeNodes||[];
 const provisioning=leased.filter(n=>n.status==='PROVISIONING');
 const active=leased.filter(n=>n.status==='ACTIVE');
 const completed=leased.filter(n=>['COMPLETED','EARLY_UNBONDED','EXPIRED'].includes(n.status));
 const featured=provisioning[0]||active[0]||completed[0];
 const allAssets=()=>onAssets(),featuredAssets=()=>onAssets(featured?.id);
 const action=account?.nextAction;
 const next:Record<NonNullable<typeof action>['kind'],{text:string;button:string;run:()=>void}>={
  SELECT_TARIFF:{text:'Выберите тариф, чтобы оформить первую ноду.',button:'Выбрать тариф',run:onMarket},
  ADD_FUNDS:{text:'Для выбранного тарифа не хватает средств на доступном балансе.',button:`${t('Пополнить на')} ${exactMoney(action?.missing||'0',locale)} USDT`,run:onFinance},
  REQUEST_PENDING:{text:'Заявка рассматривается оператором.',button:'Мои GPU',run:featuredAssets},
  PROVISIONING:{text:'Заказ оплачен. Сервис назначает оборудование.',button:'Открыть GPU',run:featuredAssets},
  EPOCH_ACTIVE:{text:'Оборудование работает. Следите за сроком и начислениями в кабинете.',button:'Открыть GPU',run:featuredAssets},
  WITHDRAW_MANUAL:{text:'После завершения срока проверьте состояние ноды.',button:'Мои GPU',run:featuredAssets},
  ORDER_UNAVAILABLE:{text:'Заказ сейчас недоступен. Выбранный тариф сохранён.',button:'Открыть тарифы',run:onMarket},
  ORDER_SOLD_OUT:{text:'Для выбранной категории нет подтверждённых свободных слотов.',button:'Сравнить тарифы',run:onMarket},
  ORDER_READY:{text:'Баланс достаточен. Проверьте условия перед заказом.',button:'Заказать ноду',run:onOrder},
  CURRENT_OFFER_REQUIRED:{text:'Примите актуальную редакцию оферты перед заказом.',button:'Открыть условия',run:onOrder},
  EPOCH_COMPLETED:{text:'Срок работы завершён. Результат и доступный баланс видны в кабинете.',button:'Мои GPU',run:featuredAssets}
 };
 const current=action?next[action.kind]:null;
 // The answers refer to the published offer and existing withdrawal flow, not estimated rates.
 const answers:[string,string,()=>void][]=[
  ['Что такое нода?','Нода — назначаемое оператором оборудование в GPU-инфраструктуре. GPU — вычислительный процессор для задач обработки данных.',onMarket],
  ['Когда начинаются начисления?','Начисления начинаются только после активации оборудования. Срок и порядок расчёта зависят от выбранного тарифа и доступны в карточке GPU.',account?allAssets:onTour],
  ['В какой сети пополнять USDT?','Для пополнения используется только USDT в сети TON и счёт, созданный в приложении.',onFinance],
  ['Что происходит после заказа?','После заказа сервис назначает и активирует оборудование. Оборудование начинает выполнять вычислительные задачи, а вы начинаете получать начисления по условиям выбранного тарифа. Состояние оборудования и начисления доступны в личном кабинете.',account?allAssets:onTour],
  ['Где правила вывода и досрочного завершения?','Откройте условия в оферте и актуальный расчёт в окне вывода или карточке GPU.',onWithdraw],
  ['Как получить помощь?','Напишите в поддержку из кабинета; обращение сохраняется в профиле.',onSupport]
 ];
 return <section className="dashboard-page" aria-labelledby="dashboard-heading">
  <PageHeader id="dashboard-heading" title={t('Главная')} subtitle={t('GPU-инфраструктура и ваши инвестиции')}/>
  <section className="panel dashboard-intro" data-tour="intro"><h2>{t('Оборудование работает — вы получаете начисления')}</h2><p>{t('Выберите тариф, пополните счёт USDT в сети TON и оформите заказ. Сервис назначит и активирует оборудование.')}</p></section>
  {account&&<div className="dashboard-overview" aria-label={t('Личный обзор')} data-tour="account"><article className="panel"><span>{t('Доступный баланс')}</span><Money value={account.balance}/></article><article className="panel"><span>{t('Выбранный тариф')}</span><strong>{account.selectedTariff?.name||t('Не выбран')}</strong>{account.selectedTariff&&<small><Money value={account.selectedTariff.depositUsdt}/> · {account.selectedTariff.days} {t('дней')}</small>}</article><article className="panel"><span>{t('Мои GPU')}</span><strong>{active.length} {t('активных')}</strong><small>{provisioning.length} {t('ожидают')}</small></article></div>}
  <div className="dashboard-quick" aria-label={t('Быстрые действия')}><QuickAction icon="node" label={t('Тарифы')} onClick={onMarket}/><QuickAction icon="download" label={t('Пополнить')} onClick={account?onFinance:onLogin}/><QuickAction icon="cluster" label={t('Мои GPU')} onClick={account?allAssets:onLogin}/></div>
  {account&&current&&<aside className="panel next-action" aria-live="polite"><span className="eyebrow">{t('Следующее действие')}</span><h2>{t(current.text)}</h2>{action?.kind==='ADD_FUNDS'&&<p>{action.tariff} · {t('Стоимость')}: <Money value={action.required||'0'}/> · {t('Не хватает')}: <Money value={action.missing||'0'}/></p>}<button className="primary" onClick={current.run}>{t(current.button)} <Icon name="arrow" size={18}/></button></aside>}
  <Section title={t('Мои GPU')} icon="cluster" actions={account&&<button className="text-button" onClick={allAssets}>{t('Открыть')} <Icon name="arrow" size={18}/></button>}>
   {!account?<EmptyState icon="user" title={t('Ваш личный кабинет')} description={t('Войдите через Telegram, чтобы увидеть свои заказы и начисления.')} action={<button className="secondary" onClick={onLogin}>{t('Войти')}</button>}/>:!leased.length?<EmptyState icon="node" title={t('Начните с выбора тарифа')} description={t('Срок работы и начисления начинаются после активации оборудования.')} action={<button className="secondary" onClick={onMarket}>{t('Выбрать тариф')}</button>}/>:<div className="dashboard-node-list">{[...provisioning,...active,...completed.slice(0,1)].slice(0,3).map((node,index)=><GpuSummary key={node.id} node={node} eager={index===0} onOpen={()=>onAssets(node.id)} onRefresh={onRefresh}/>)}</div>}
  </Section>
  <Section title={t('Как это работает')} icon="journey" actions={<button className="text-button" onClick={onTour}>{t('Демонстрация')} <Icon name="arrow" size={18}/></button>}><p className="dashboard-explanation">{t('Нода — оборудование для вычислений. Его срок работы начинается после активации.')}</p><div className="dashboard-how"><article><Icon name="node"/><h3>{t('Выберите тариф')}</h3><p>{t('Сравните депозит, ставку и срок работы.')}</p></article><article><Icon name="wallet"/><h3>{t('Пополните и оформите заказ')}</h3><p>{t('Выбор тарифа сам по себе не списывает баланс.')}</p></article><article><Icon name="bolt"/><h3>{t('Следите за начислениями')}</h3><p>{t('Все операции и статусы доступны в кабинете.')}</p></article></div><button className="secondary" onClick={onTour}>{t('Посмотреть демонстрацию')}</button></Section>
  <Section title={t('Категории оборудования')} icon="node" actions={<button className="text-button" onClick={onMarket}>{t('Все тарифы')} <Icon name="arrow" size={18}/></button>}><div className="ui-list-group">{nodes.filter(n=>!n.experimental).slice(0,3).map(n=><ListRow key={n.id} icon="node" title={n.name} description={`${n.contractDays} ${t('дней')} · ${t(n.availability==='AVAILABLE'?'Можно заказать':n.availability==='SOLD_OUT'?'Нет свободных слотов':n.availability==='UNCONFIGURED'?'Слоты не подтверждены':'Заказ сейчас недоступен')}`} value={<Money value={n.priceUsdt}/>} onClick={onMarket}/>)}{!nodes.length&&!problem&&<p role="status">{t('Параметры тарифов загружаются из каталога.')}</p>}</div>{problem&&<div className="dashboard-problem" role="alert"><p>{problem}</p><button className="secondary" onClick={()=>setRetry(v=>v+1)}>{t('Повторить')}</button></div>}</Section>
  <Section title={t('Вопросы и помощь')} icon="help" actions={<button className="text-button" onClick={onSupport}>{t('Поддержка')}</button>}><div className="dashboard-faq">{answers.map(([question,answer,run])=><details key={question}><summary>{t(question)}</summary><p>{t(answer)}</p><button className="text-button" onClick={run}>{t(question.startsWith('Где')?'Открыть окно вывода':'Подробнее')} <Icon name="arrow" size={18}/></button></details>)}</div><button className="text-button" onClick={onOffer}>{t('Публичная оферта')}</button></Section>
 </section>;
}
