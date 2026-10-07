import {useEffect,useRef,useState} from 'react';
import {useLanguage} from './i18n';
import {api} from './api';
import {Icon} from './Icons';
import './product-tour.css';

const slides=[
 {title:'Выбор тарифа',body:'Сравните фиксированный депозит и срок Epoch. Выбор тарифа сохраняется без списания средств.',focus:'tariff'},
 {title:'Пополнение USDT · TON',body:'Подключите TON-кошелёк, создайте счёт и переведите USDT только в сети TON.',focus:'invoice'},
 {title:'Подтверждение зачисления',body:'После проверки перевода сумма появится на доступном балансе в кабинете.',focus:'balance'},
 {title:'Проверка заказа',body:'Перед подтверждением вы увидите категорию, сумму списания, режим и действующие условия.',focus:'review'},
 {title:'Назначение и активация',body:'После заказа оператор назначает оборудование. Только после активации начинается Epoch.',focus:'activation'},
 {title:'Контроль в кабинете',body:'Статус ноды, срок Epoch, история операций, вывод и поддержка доступны в профиле.',focus:'control'}
] as const;
const version='aethermind-tour-v1';

export default function ProductTour({onClose,onMarket}:{onClose:()=>void;onMarket:()=>void}){
 const {t}=useLanguage(),[index,setIndex]=useState(0),[tariffs,setTariffs]=useState<{id:string;name:string;priceUsdt:string;contractDays:number;experimental:boolean}[]>([]),dialog=useRef<HTMLDivElement>(null),opener=useRef<HTMLElement|null>(null);
 useEffect(()=>{let live=true;void api<{nodes:typeof tariffs}>('/v1/market').then(data=>{if(live)setTariffs(data.nodes.filter(row=>!row.experimental).slice(0,2))}).catch(()=>{});return()=>{live=false}},[]);
 useEffect(()=>{opener.current=document.activeElement as HTMLElement;dialog.current?.focus();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=overflow;opener.current?.focus()}},[]);
 useEffect(()=>{const target=dialog.current?.querySelector<HTMLElement>(`[data-tour="${slides[index].focus}"]`);const align=()=>target?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});align();window.addEventListener('resize',align);return()=>window.removeEventListener('resize',align)},[index]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();onClose()}if(e.key==='ArrowRight')setIndex(i=>Math.min(slides.length-1,i+1));if(e.key==='ArrowLeft')setIndex(i=>Math.max(0,i-1));if(e.key==='Tab'){const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');if(!items?.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault()}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault()}}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[onClose]);
 const finish=()=>{try{localStorage.setItem('aethermind.tour.version',version)}catch{}onClose()};
 const active=slides[index];
 return <div className="tour-backdrop" role="presentation"><div className="tour-panel" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description" ref={dialog} tabIndex={-1}>
  <header className="tour-header"><div><span className="eyebrow">AETHERMIND / {t('Демонстрация')}</span><h2 id="tour-title">{t(active.title)}</h2></div><button className="icon-button" aria-label={t('Закрыть демонстрацию')} onClick={finish}><Icon name="close"/></button></header>
  <p id="tour-description">{t(active.body)}</p><div className="tour-label">{t('ДЕМОНСТРАЦИЯ · БЕЗ ПЛАТЕЖЕЙ И ПОДПИСЕЙ')}</div>
  <div className="tour-preview" aria-live="polite">
   {index===0&&<div className="tour-cards">{tariffs.length?tariffs.map((row,i)=><div className="tour-mock" key={row.id} data-tour={i===0?'tariff':undefined}><span>{row.name}</span><strong>{row.priceUsdt} USDT</strong><small>Epoch · {row.contractDays} {t('дней')}</small>{i===0&&<span className="tour-faux-button">{t('Выбрать тариф')}</span>}</div>):<div className="tour-mock" data-tour="tariff"><strong>{t('Сравните тарифы в каталоге')}</strong><small>{t('Цена и срок загрузятся из каталога.')}</small></div>}</div>}
   {index===1&&<div className="tour-mock" data-tour="invoice"><span>TON CONNECT</span><strong>{t('Подключите TON-кошелёк')}</strong><p>{t('Создайте счёт на выбранную сумму. У каждого счёта отдельный идентификатор для проверки перевода.')}</p><span className="tour-faux-button">USDT · TON</span></div>}
   {index===2&&<div className="tour-mock" data-tour="balance"><span>{t('ПРОВЕРКА ПЕРЕВОДА')}</span><div className="tour-sequence"><span>{t('Счёт создан')}</span><Icon name="arrow" size={17}/><span>{t('Перевод проверен')}</span><Icon name="arrow" size={17}/><span>{t('Баланс обновлён')}</span></div><strong>{tariffs[0]?`+${tariffs[0].priceUsdt} USDT`:t('Доступный баланс')}</strong></div>}
   {index===3&&<div className="tour-mock" data-tour="review"><span>{t('ПРОВЕРКА ЗАКАЗА')}</span><dl><div><dt>{t('Тариф')}</dt><dd>{tariffs[0]?.name||t('Выбранный тариф')}</dd></div><div><dt>{t('Будет списано')}</dt><dd>{tariffs[0]?`${tariffs[0].priceUsdt} USDT`:'—'}</dd></div><div><dt>{t('Режим')}</dt><dd>BASE</dd></div><div><dt>Epoch</dt><dd>{tariffs[0]?.contractDays||'—'} {t('дней после активации')}</dd></div></dl><span className="tour-faux-button">{t('Подтвердить заказ')}</span></div>}
   {index===4&&<div className="tour-mock" data-tour="activation"><span>{t('СТАТУС НОДЫ')}</span><div className="tour-sequence"><span>{t('Заказ создан')}</span><Icon name="arrow" size={17}/><span>{t('Оператор назначает оборудование')}</span><Icon name="arrow" size={17}/><span>{t('Epoch активен')}</span></div><p>{t('Дата активации и срок появляются после действия оператора.')}</p></div>}
   {index===5&&<div className="tour-mock" data-tour="control"><span>{t('ЛИЧНЫЙ КАБИНЕТ')}</span><div className="tour-controls"><span><Icon name="node" size={16}/> {t('Мои ноды')}</span><span><Icon name="clock" size={16}/> {t('История активности')}</span><span><Icon name="wallet" size={16}/> {t('Вывод')}</span><span><Icon name="help" size={16}/> {t('Поддержка')}</span></div></div>}
  </div>
  <footer className="tour-footer"><span aria-live="polite">{t('Шаг')} {index+1} / {slides.length}</span><div className="tour-progress" aria-hidden="true">{slides.map((slide,i)=><span key={slide.focus} className={i===index?'active':''}/>)}</div><div className="tour-buttons"><button className="secondary" disabled={index===0} onClick={()=>setIndex(i=>i-1)}>{t('Назад')}</button><button className="secondary" onClick={finish}>{t('Пропустить')}</button>{index<slides.length-1?<button className="primary" onClick={()=>setIndex(i=>i+1)}>{t('Далее')}</button>:<button className="primary" onClick={()=>{finish();onMarket()}}>{t('Перейти к тарифам')}</button>}</div></footer>
 </div></div>;
}
