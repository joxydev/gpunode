import {memo,useCallback,useEffect,useRef,useState,useSyncExternalStore,type RefObject} from 'react';
import type {Lease} from './api';
import {useLanguage} from './i18n';
import {Money,StatusPill} from './UI';
import {statusLabels} from './production-types';
import {liveAmounts,microDecimal,serverClock,timerText,workloadFrame} from './live-accrual';
import {useAppActive} from './motion';
import './gpu-live.css';

const hardware:Record<string,{path:string;chip:string;purpose:string}>={
 NODE_4090:{path:'/assets/market/4090',chip:'RTX 4090',purpose:'Нейрорендеринг и компьютерное зрение'},
 NODE_A100:{path:'/assets/market/a100',chip:'A100',purpose:'Языковые модели и обработка батчей'},
 NODE_H100:{path:'/assets/market/h100',chip:'H100',purpose:'Вычисления моделей и научное моделирование'},
 NODE_QBIT:{path:'/assets/market/qbit',chip:'Quantum',purpose:'Экспериментальная категория'}
};
export function GpuArt({node,compact=false,eager=false}:{node:Lease;compact?:boolean;eager?:boolean}){
 const {t}=useLanguage(),info=hardware[node.nodeId];if(!info)return <span className="gpu-unknown">GPU</span>;
 const prefix=compact?'card':'detail',sizes=compact?[160,320,480]:[360,720,1080];
 return <img className={compact?'gpu-thumbnail':'gpu-art'} src={`${info.path}/${prefix}-${sizes[0]}.webp`}
  srcSet={sizes.map(size=>`${info.path}/${prefix}-${size}.webp ${size}w`).join(', ')} sizes={compact?'80px':'(min-width:1024px) 360px, (min-width:768px) 40vw, 85vw'}
  width={sizes[0]} height={sizes[0]} loading={eager?'eager':'lazy'} decoding="async" draggable={false}
  alt={`${t('Художественная визуализация GPU')} · ${info.chip}`}/>;
}
function useVisible(ref:RefObject<HTMLElement>){
 const [visible,setVisible]=useState(true);useEffect(()=>{const element=ref.current;if(!element)return;
  const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'24px'});observer.observe(element);return()=>observer.disconnect();},[ref]);return visible;
}
const idleSubscribe=()=>()=>{};
function useTime(visible:boolean){const subscribe=useCallback(visible?serverClock.subscribe:idleSubscribe,[visible]);return useSyncExternalStore(subscribe,serverClock.getSnapshot);}
const states:Record<string,string>={SYNCING:'Ожидаем суточный расчёт',PAUSED:'Начисления на паузе',PROVISIONING:'Ожидает активации',COMPLETED:'Срок завершён',EARLY_UNBONDED:'Завершено досрочно',CANCELLED:'Заказ отменён',UNAVAILABLE:'Условия уточняются оператором'};

const LiveStats=memo(function LiveStats({node,compact=false,onRefresh}:{node:Lease;compact?:boolean;onRefresh:()=>Promise<void>}){
 const {t}=useLanguage(),ref=useRef<HTMLDivElement>(null),visible=useVisible(ref),snapshot=node.liveAccrual;
 const time=useTime(visible&&Boolean(snapshot?.state==='ACTIVE'&&snapshot.validSnapshot));
 const requested=useRef(''),refresh=useRef(onRefresh);refresh.current=onRefresh;
 const now=time.now||Date.parse(snapshot?.serverNow||''),amount=snapshot?liveAmounts(snapshot,now):null;
 const boundary=Boolean(amount?.boundary),waiting=snapshot?.state==='ACTIVE'&&(!time.ready||boundary);
 useEffect(()=>{if(!visible||!boundary||!snapshot)return;const key=snapshot.periodEnd||'';if(requested.current===key)return;requested.current=key;void refresh.current().catch(()=>{});},[visible,boundary,snapshot?.periodEnd]);
 return <div ref={ref} className={compact?'gpu-live compact':'gpu-live'} data-live-state={snapshot?.state||'UNAVAILABLE'}>
  {snapshot?.state==='ACTIVE'&&amount?<>
   <div className="gpu-profit"><small>{t('Расчётная прибыль за текущие сутки')}</small><strong data-current-micros={amount.current.toString()}><Money value={microDecimal(amount.current)} precision={6}/></strong></div>
   <div className="gpu-timer"><small>{t('До расчёта за сутки')}</small><b data-countdown>{timerText(amount.remaining)}</b></div>
   {!compact&&<><div className="gpu-day-track" role="progressbar" aria-label={t('Текущие расчётные сутки')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(amount.progress*100)}><i style={{transform:`scaleX(${amount.progress})`}}/></div>
    <dl className="gpu-live-facts"><div><dt>{t('За последние 10 секунд')}</dt><dd data-delta-micros={amount.delta.toString()}>+<Money value={microDecimal(amount.delta)} precision={6}/></dd></div><div><dt>{t('За сутки по текущему расчёту')}</dt><dd><Money value={microDecimal(amount.daily)} precision={6}/></dd></div></dl>
   </>}
   {waiting&&<small className="gpu-sync" role="status">{t(boundary?'Ожидаем обновление периода':'Данные устарели. Обновляем расчёт.')}</small>}
  </>:<p className="gpu-state">{t(states[snapshot?.state||'UNAVAILABLE'])}</p>}
  {!compact&&snapshot&&<><dl className="gpu-confirmed"><div><dt>{t('Подтверждено расчётом')}</dt><dd><Money value={microDecimal(BigInt(snapshot.confirmedProfitMicros))}/></dd></div>{snapshot.pendingDays>0&&<div><dt>{t('Завершённые сутки ожидают расчёта')}</dt><dd><Money value={microDecimal(BigInt(snapshot.pendingProfitMicros))}/></dd></div>}</dl><p className="gpu-counter-note">{t('Счётчик показывает расчёт внутри суток. Подтверждённые начисления обновляются после суточного расчёта.')}</p></>}
 </div>;
});

const tasks:Record<string,string[]>={alpha:['Нейрорендеринг','Обработка изображений','Инференс компьютерного зрения'],beta:['Инференс языковой модели','Подготовка батча','Настройка модели'],enterprise:['Обработка большого батча','Вычисления модели','Научное моделирование']};
function Workload({node}:{node:Lease}){
 const {t}=useLanguage(),ref=useRef<HTMLElement>(null),visible=useVisible(ref),active=useAppActive();
 const canRun=Boolean(node.status==='ACTIVE'&&node.liveAccrual?.state==='ACTIVE'&&node.liveAccrual.validSnapshot),time=useTime(visible&&active&&canRun);
 const running=canRun&&time.ready,frameRef=useRef(workloadFrame(node.id,node.nodeId,time.now));
 if(visible&&active&&running)frameRef.current=workloadFrame(node.id,node.nodeId,Math.floor(time.now/6000)*6000);
 const frame=frameRef.current;
 const task=(tasks[frame.category]||tasks.enterprise)[frame.task];
 const staticLabel=node.liveAccrual?.state==='UNAVAILABLE'||node.status==='OVERCLOCKED'?'Условия уточняются оператором':node.status==='PROVISIONING'?'Подготовка оборудования':node.status==='CANCELLED'?'Заказ отменён':node.status==='ACTIVE'?'Визуализация приостановлена':'Работа завершена';
 return <section ref={ref} className="gpu-workload" data-paused={!visible||!active||!running} aria-label={t('Визуализация работы')}>
  <header><h3>{t('Визуализация работы')}</h3><small>{t('Иллюстративная нагрузка')}</small></header>
  {running?<><p className="gpu-task" key={task}>{t(task)}</p><div className="gpu-load-title"><span>{t(['Подготовка','Обработка','Завершение задачи'][frame.stage])}</span><b>{frame.load}%</b></div><div className="gpu-load-track"><i style={{transform:`scaleX(${frame.load/100})`}}/></div><div className="gpu-load-title"><span>{t('Обработка пакета')}</span><b>{frame.progress}%</b></div><div className="gpu-load-track gpu-load-secondary"><i style={{transform:`scaleX(${frame.progress/100})`}}/></div></>:<p>{t(staticLabel)}</p>}
 </section>;
}
export function GpuSummary({node,onOpen,onRefresh,eager=false}:{node:Lease;onOpen:()=>void;onRefresh:()=>Promise<void>;eager?:boolean}){
 const {t}=useLanguage();return <button className="panel gpu-summary" id={'gpu-row-'+node.id} onClick={onOpen}>
  <GpuArt node={node} compact eager={eager}/><span className="gpu-summary-title"><b>{node.node?.name||node.nodeId}</b><small>{node.mode==='COMPOUND'?'Compound Boost':node.mode||'—'}{node.liveAccrual?.periodIndex?` · ${t('День')} ${node.liveAccrual.periodIndex} / ${node.contractDays}`:''}</small></span>
  <StatusPill status={node.status} label={t(statusLabels[node.status]||node.status)}/><LiveStats node={node} compact onRefresh={onRefresh}/>
 </button>;
}
export function GpuDetail({node,onRefresh}:{node:Lease;onRefresh:()=>Promise<void>}){
 const {t}=useLanguage(),info=hardware[node.nodeId];return <article className="panel gpu-detail">
  <div className="gpu-identity"><div><span className="eyebrow">{info?.chip||'GPU'} / {node.mode==='COMPOUND'?'Compound Boost':node.mode||'—'}</span><p>{info?t(info.purpose):t('Назначение оборудования уточняется оператором.')}</p></div><StatusPill status={node.status} label={t(statusLabels[node.status]||node.status)}/></div>
  <div className="gpu-detail-columns"><div className="gpu-visual"><GpuArt node={node} eager/></div><div className="gpu-financial"><LiveStats node={node} onRefresh={onRefresh}/></div><Workload node={node}/><dl className="gpu-capital"><div><dt>{t('Первоначальный депозит')}</dt><dd>{node.principal?<Money value={node.principal}/>: '—'}</dd></div>{node.mode==='COMPOUND'&&<><div><dt>{t('Капитал с реинвестированием')}</dt><dd>{node.compoundCapital?<Money value={node.compoundCapital}/>: '—'}</dd></div><div><dt>{t('Накопленная Compound-прибыль')}</dt><dd>{node.compoundProfit?<Money value={node.compoundProfit}/>: '—'}</dd></div></>}<div><dt>{t('Ставка')}</dt><dd>{(node.mode==='COMPOUND'?node.compoundDailyRateBps:node.baseDailyRateBps)?String((node.mode==='COMPOUND'?node.compoundDailyRateBps:node.baseDailyRateBps)!/100)+'% / '+t('сутки'):'—'}</dd></div><div><dt>{t('Срок работы')}</dt><dd>{node.contractDays||'—'} {t('дней')}</dd></div></dl></div>
 </article>;
}
