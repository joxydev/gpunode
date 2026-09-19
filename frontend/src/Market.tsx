import {useCallback,useEffect,useRef,useState} from 'react';
import {api,haptic,type NodeSpec} from './api';
import {Icon} from './Icons';
import './market.css';
import './market-accessibility.css';

type Node = {id:string;name:string;category:string;tier:number;chip:string;precision:string;workload:string;priceUsdt:string;dailyPercent:string;dailyUsdt:string;aprPercent:string;termYieldUsdt:string;tflops:number;contractDays:number;maxPerUser:number;totalSupply:number|null;availableSupply:number|null;remainingPercent:number|null;availability:string;image:string;experimental:boolean;termsStatus:string;canBuy:boolean;canRequest:boolean};
const categories=[['ALL','Все'],['CONSUMER','Consumer'],['ENTERPRISE','Enterprise'],['QUANTUM','Quantum']];
const status:Record<string,string>={AVAILABLE:'Доступно',LIMITED:'Мало нод',SOLD_OUT:'Кластер заполнен',AWAITING_POOL:'Пул уточняется',CONCEPT:'Экспериментальная'};
const number=(value:string|number,decimals=0)=>Number(value).toLocaleString('ru-RU',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
function Art({node,detail=false}:{node:Node;detail?:boolean}) {
  const prefix=detail?'detail':'card',sizes=detail?[360,720,1080]:[160,320,480];
  return <img className="market-art" src={`${node.image}/${prefix}-${sizes[1]}.webp`} srcSet={sizes.map(s=>`${node.image}/${prefix}-${s}.webp ${s}w`).join(', ')} sizes={detail?'(max-width: 600px) 85vw, 360px':'(max-width: 600px) 240px, 280px'} width={sizes[1]} height={sizes[1]} loading={detail?'eager':'lazy'} alt={`Художественная визуализация ${node.name}`}/>;
}
function Pool({node}:{node:Node}) {
  return <div className="market-pool"><div><span>Остаток пула</span><strong>{node.remainingPercent===null?'Нет данных':number(node.remainingPercent)+'%'}</strong></div>
    {node.remainingPercent===null?<div className="pool-track unknown" aria-label="Количество нод ещё не опубликовано"/>:<progress value={node.availableSupply||0} max={node.totalSupply||1} aria-label={`Доступно ${node.availableSupply} из ${node.totalSupply} нод`}/>}
    <small>{node.availableSupply===null?'Количество опубликуем после проверки оборудования':`${number(node.availableSupply)} из ${number(node.totalSupply||0)} нод доступно`}</small>
  </div>;
}
export default function Market({onRequest}:{onRequest:(node:NodeSpec)=>void}) {
  const [category,setCategory]=useState('ALL'),[sort,setSort]=useState('tier_asc'),[nodes,setNodes]=useState<Node[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState<Node|null>(null),[updated,setUpdated]=useState('');
  const dialog=useRef<HTMLDialogElement>(null),generation=useRef(0),opener=useRef<HTMLElement|null>(null);
  const reload=useCallback(async(background=false)=>{
    const current=++generation.current;
    if(!background){setLoading(true);setNodes([]);}setError('');
    try{const data=await api<{nodes:Node[];updatedAt:string}>(`/v1/market?category=${category}&sort=${sort}`);
      if(current!==generation.current)return;setNodes(data.nodes);setUpdated(data.updatedAt);
      setSelected(old=>old?data.nodes.find(n=>n.id===old.id)||null:null);
    }catch(e){if(current===generation.current)setError((e as Error).message);}
    finally{if(current===generation.current)setLoading(false);}
  },[category,sort]);
  useEffect(()=>{void reload();const timer=setInterval(()=>{if(document.visibilityState==='visible')void reload(true);},30000);return()=>{++generation.current;clearInterval(timer);};},[reload]);
  useEffect(()=>{if(!selected){dialog.current?.close();return;}
    const el=dialog.current;if(!el)return;
    if(!el.open)el.showModal();const old=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=old;};
  },[selected]);
  function close(){setSelected(null);dialog.current?.close();opener.current?.focus();}
  function open(node:Node){opener.current=document.activeElement as HTMLElement;haptic();setSelected(node);}
  function request(node:Node){close();onRequest({id:node.id,name:node.name,label:`TIER ${node.tier} / ${node.category}`,memory:node.chip,compute:node.precision,use:node.workload,image:node.image+'/detail-360.webp',status:node.experimental?'CONCEPT':'ON_REQUEST',price:null});}
  return <section className="market" aria-labelledby="market-heading">
    <header className="market-heading"><span className="eyebrow">AETHERMIND / COMPUTE MARKET</span><div><h1 id="market-heading">Выберите<br/><span>свою мощность.</span></h1><div className="market-symbol" aria-hidden="true"><Icon name="node" size={38}/><i/><i/></div></div><p>От персональной GPU до серверного кластера.<br/>Ресурсы для следующего поколения AI.</p></header>
    <div className="market-summary"><span><i/> КАТАЛОГ КОНФИГУРАЦИЙ</span><b>Tier 01 — 04</b></div>
    <div className="market-tabs" role="group" aria-label="Класс оборудования">{categories.map(([id,label])=><button key={id} aria-pressed={category===id} className={category===id?'selected':''} onClick={()=>{haptic();setCategory(id);}}>{label}</button>)}</div>
    <div className="market-toolbar"><span aria-live="polite">{loading?'Загрузка…':`${nodes.length} конфигурации`}</span><label><span className="sr-only">Сортировка</span><select aria-label="Сортировка" value={sort} onChange={e=>setSort(e.target.value)}><option value="tier_asc">Уровень: по возрастанию</option><option value="tier_desc">Уровень: по убыванию</option><option value="price_asc">Цена: по возрастанию</option><option value="price_desc">Цена: по убыванию</option><option value="apr_desc">Расчётный APR: выше</option><option value="apr_asc">Расчётный APR: ниже</option></select></label></div>
    <div className="market-disclosure"><Icon name="shield" size={18}/><p>Цены и проценты — параметры будущих контрактов. До их подключения доступны заявки без оплаты; доход не начисляется.</p></div>
    {error&&<div role="alert" className="alert error">{error}<div><button className="text-button" onClick={()=>void reload()}>Повторить загрузку</button></div></div>}
    <div className="market-grid" aria-busy={loading}>{loading?Array.from({length:2},(_,i)=><div className="market-skeleton" key={i} aria-hidden="true"><div/><span/><span/></div>):nodes.map(node=><article key={node.id} className={`market-card ${node.tier>=3?'premium':''} ${node.availability==='SOLD_OUT'?'sold-out':''} ${node.experimental?'concept':''}`}>
      <div className="market-meta"><span className={'market-status '+node.availability.toLowerCase()}><i/>{status[node.availability]}</span><span className="market-tier">TIER {node.tier.toString().padStart(2,'0')}</span></div>
      <button className="market-image-button" aria-label={`Подробнее о ${node.name}`} onClick={()=>open(node)}><Art node={node}/><span className="art-floor"/></button>
      <div className="market-card-body"><span className="market-category">{node.category} TIER</span><button className="market-title" onClick={()=>open(node)}><h2>{node.name}</h2><Icon name="arrow" size={19}/></button><p className="market-workload">{node.workload}</p>
      <div className="market-specs"><div><small>ВЫЧИСЛЕНИЯ{node.experimental?' / КОНЦЕПЦИЯ':''}</small><strong>{number(node.tflops)}<em> TFLOPS</em></strong></div><div><small>ПАМЯТЬ / АРХИТЕКТУРА</small><strong>{node.chip}</strong></div></div><p className="market-precision">{node.precision}</p>
      <div className="market-yield"><div><small>Расчёт по проекту контракта</small><strong>{number(node.dailyUsdt,2)} <em>USDT / день</em></strong></div><span>{number(node.dailyPercent,1)}%<small>В СУТКИ*</small></span></div>
      <Pool node={node}/><div className="market-price"><div><strong>{number(node.priceUsdt)} <small>USDT</small></strong><span>Плановая стоимость · {node.contractDays} дней</span></div><span className="market-limit">до {node.maxPerUser}<small>на аккаунт</small></span></div>
      <button className="primary wide market-action" disabled={node.availability==='SOLD_OUT'} onClick={()=>open(node)}>{node.availability==='SOLD_OUT'?'Кластер заполнен':node.experimental?'Изучить концепцию':'Условия аренды'}<Icon name="arrow" size={18}/></button>
      </div></article>)}</div>
    {!loading&&!error&&!nodes.length&&<div className="empty panel"><h3>Нет конфигураций</h3><p>В выбранной категории оборудование пока не опубликовано.</p><button className="secondary" onClick={()=>setCategory('ALL')}>Все категории</button></div>}
    <p className="market-footnote">* Расчётная ставка не подтверждает фактическую прибыль. APR = ставка в день × 365, без реинвестирования. Режимы точности TFLOPS различаются; показатели нельзя сравнивать напрямую. Изображения — художественные визуализации.</p>
    {updated&&<p className="market-sync">Обновлено {new Date(updated).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})} · параметры синхронизируются каждые 30 секунд</p>}
    <dialog className="market-dialog" ref={dialog} onCancel={e=>{e.preventDefault();close();}} onClose={()=>setSelected(null)} onClick={e=>{if(e.target===e.currentTarget)close();}} aria-labelledby="market-detail-title">
      {selected&&<div className="market-detail"><button autoFocus className="icon-button market-close" aria-label="Закрыть характеристики" onClick={close}><Icon name="close"/></button><div className={'market-detail-art '+(selected.tier>=3?'premium':'')}><Art node={selected} detail/></div><span className="market-category">{selected.category} / TIER {selected.tier}</span><h2 id="market-detail-title">{selected.name}</h2><p>{selected.workload}</p>
        <dl className="market-details-list"><div><dt>Память / архитектура</dt><dd>{selected.chip}</dd></div><div><dt>Мощность</dt><dd>{number(selected.tflops)} TFLOPS{selected.experimental?' (концепция)':''}</dd></div><div><dt>Метод измерения</dt><dd>{selected.precision}</dd></div><div><dt>Плановая стоимость</dt><dd>{number(selected.priceUsdt,2)} USDT</dd></div><div><dt>Плановый срок</dt><dd>{selected.contractDays} дней</dd></div><div><dt>Лимит на аккаунт</dt><dd>{selected.maxPerUser} нод</dd></div></dl>
        <section className="market-contract"><span className="market-category">ПРОЕКТ КОНТРАКТА</span><h3>Расчётные параметры</h3><div className="market-contract-grid"><div><small>В день</small><b>{number(selected.dailyUsdt,2)} USDT</b></div><div><small>Ставка в день</small><b>{number(selected.dailyPercent,1)}%</b></div><div><small>APR без реинвестирования</small><b>{number(selected.aprPercent,1)}%</b></div><div><small>За {selected.contractDays} дней*</small><b>{number(selected.termYieldUsdt,2)} USDT</b></div></div><p>* Арифметический расчёт по указанной ставке, без комиссий. Это не начисление и не гарантия дохода. Возврат стоимости и фактическое распределение выручки будут определены в договоре.</p></section>
        <Pool node={selected}/><p className="market-detail-note">{selected.experimental?'Quantum — концепция R&D. Фотонное оборудование и заявленная мощность не подтверждены, аренда недоступна.':'Подписанный контракт и подтверждённый пул ещё не подключены. Оператор согласует наличие оборудования и условия по вашей заявке.'}</p>
        <button className="secondary wide" disabled>{selected.availability==='SOLD_OUT'?'Кластер заполнен':selected.experimental?'Экспериментальное направление':'Оплата откроется после подключения контракта'}</button>
        {selected.canRequest&&<button className="primary wide" onClick={()=>request(selected)}>Оставить заявку без оплаты <Icon name="arrow" size={18}/></button>}
      </div>}
    </dialog>
  </section>;
}
