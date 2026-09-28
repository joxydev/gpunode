import {useEffect,useRef,useState} from 'react';
import {useIsConnectionRestored,useTonConnectUI,useTonWallet} from '@tonconnect/ui-react';
import {useLanguage,intlLocale,languages,type Language} from './i18n';
import {api,type Account} from './api';
import {tonCapabilities} from './ton-capabilities';
import {useAppBack} from './navigation';
import {Icon} from './Icons';
import Assets from './Assets';
import Referrals from './Referrals';
import Privacy from './Privacy';
import './account.css';

type Page='root'|'account'|'assets'|'wallets'|'security'|'notifications'|'partners'|'language'|'documents'|'privacy'|'status'|'about';
type WalletState={connectedWallet:string|null;rawAddress:string|null;verified:boolean;walletVersion:string|null;gaslessAvailable:boolean};
const labels:Record<Exclude<Page,'root'>,string>={account:'Аккаунт',assets:'Мои ноды',wallets:'Кошельки',security:'Безопасность',notifications:'Уведомления',partners:'Партнёры',language:'Язык',documents:'Документы',privacy:'Конфиденциальность',status:'Состояние системы',about:'О платформе'};
const items:{page:Exclude<Page,'root'>;icon:string}[]=[{page:'account',icon:'user'},{page:'assets',icon:'node'},{page:'wallets',icon:'wallet'},{page:'security',icon:'shield'},{page:'notifications',icon:'bolt'},{page:'partners',icon:'users'},{page:'language',icon:'grid'},{page:'documents',icon:'copy'},{page:'privacy',icon:'lock'},{page:'status',icon:'check'},{page:'about',icon:'node'}];
const short=(address:string)=>address.slice(0,7)+'…'+address.slice(-5);
const notificationKeys=['Платежи','Тарифы','Epoch','Поддержка','Системные события'] as const;

export default function Profile({account,bot,onMarket,onOffer,onAgreement,onSupport,onLogout,onNotice,onError,initialPage='root'}:{account:Account;bot:string;onMarket:()=>void;onOffer:()=>void;onAgreement:()=>void;onSupport:()=>void;onLogout:()=>void;onNotice:(s:string)=>void;onError:(s:string)=>void;initialPage?:Page}){
 const {t,language,choose}=useLanguage(),locale=intlLocale(language),[page,setPage]=useState<Page>(initialPage);
 const [ui]=useTonConnectUI(),wallet=useTonWallet(),restored=useIsConnectionRestored();
 const opener=useRef<HTMLElement|null>(null),previousPage=useRef<Page>('root');
 const [walletState,setWalletState]=useState<WalletState|null>(null),[walletLoading,setWalletLoading]=useState(false),[walletBusy,setWalletBusy]=useState(false),[walletError,setWalletError]=useState('');
 const settingsKey='aethermind.notifications.'+account.user.id;
 const [preferences,setPreferences]=useState<Record<string,boolean>>(()=>{try{return {...Object.fromEntries(notificationKeys.map(key=>[key,true])),...JSON.parse(localStorage.getItem(settingsKey)||'{}')}}catch{return Object.fromEntries(notificationKeys.map(key=>[key,true]))}});
 useEffect(()=>setPage(initialPage),[initialPage]);
 function openPage(next:Page){opener.current=document.activeElement as HTMLElement;previousPage.current=page;setPage(next)}
 function back(){setPage(page==='privacy'&&previousPage.current==='documents'?'documents':'root');requestAnimationFrame(()=>{(opener.current?.isConnected?opener.current:document.getElementById('account-heading'))?.focus()})}
 useAppBack(page!=='root',back);
 useEffect(()=>{if(page!=='wallets')return;let live=true;if(!walletState)setWalletLoading(true);void api<WalletState>('/v1/wallet').then(result=>{if(live)setWalletState(result)}).catch(e=>{if(live)setWalletError((e as Error).message)}).finally(()=>{if(live)setWalletLoading(false)});return()=>{live=false}},[page,account.updatedAt,wallet?.account.address]);
 const verified=Boolean(wallet&&wallet.account.chain==='-239'&&walletState?.verified&&(wallet.account.address===walletState.rawAddress||wallet.account.address===walletState.connectedWallet));
 const capabilities=tonCapabilities(wallet,walletState?.walletVersion,walletState?.gaslessAvailable||false);
 const gaslessCompatible=verified&&capabilities.supportsSignMessage&&walletState?.walletVersion==='W5';
 async function reconnect(){setWalletBusy(true);setWalletError('');try{ui.setConnectRequestParameters({state:'loading'});const nonce=await api<{payload:string}>('/v1/ton/proof/payload',{});ui.setConnectRequestParameters({state:'ready',value:{tonProof:nonce.payload}});if(wallet)await ui.disconnect();await ui.openModal()}catch(e){setWalletError((e as Error).message)}finally{setWalletBusy(false)}}
 function toggle(key:string){const next={...preferences,[key]:!preferences[key]};setPreferences(next);try{localStorage.setItem(settingsKey,JSON.stringify(next))}catch{/* private mode */}}
 const profileHeader=<div className="account-header panel"><div className="account-avatar" aria-hidden="true">{account.user.name?.trim().charAt(0).toUpperCase()||'A'}</div><div><h2>{account.user.name}</h2><p>{account.user.username?'@'+account.user.username:t('Имя пользователя не указано')}</p><small>Telegram ID · {account.user.id} · {t('Регистрация')} {new Date(account.user.createdAt).toLocaleDateString(locale)}</small></div></div>;
 return <section className="account-page" aria-labelledby="account-heading">
  <header className="section-title"><h1 id="account-heading" tabIndex={-1}>{t('Профиль')}</h1><span className="micro">AETHERMIND / ACCOUNT</span></header>
  {page!=='root'&&<button className="secondary account-back" onClick={back}>← {t('Профиль')}</button>}
  {page==='root'?<>{profileHeader}<div className="account-grid">{items.map(item=><button className="panel account-link" key={item.page} onClick={()=>openPage(item.page)}><Icon name={item.icon} size={21}/><span>{t(labels[item.page])}</span><Icon name="chevron" size={16}/></button>)}<button className="panel account-link" onClick={onSupport}><Icon name="help" size={21}/><span>{t('Поддержка')}</span><Icon name="chevron" size={16}/></button></div><button className="secondary account-logout" onClick={onLogout}><Icon name="logout" size={19}/>{t('Выйти из аккаунта')}</button></>:<>
   {page==='account'&&<div className="account-content">{profileHeader}<article className="panel account-info"><h2>{t('Аккаунт')}</h2><p>Telegram ID: {account.user.id}</p><p>{t('Регистрация')}: {new Date(account.user.createdAt).toLocaleString(locale)}</p></article></div>}
   {page==='assets'&&<Assets nodes={account.activeNodes} onMarket={onMarket} onOffer={onOffer}/>}
   {page==='wallets'&&<article className="panel account-content"><h2>{t('Кошельки')}</h2><p>{t('TON-кошелёк')} · TON Mainnet</p>{walletLoading?<div className="activity-skeleton" role="status" aria-label={t('Загрузка…')}><i/><i/></div>:<><strong className="account-address">{wallet?short(wallet.account.address):t('Кошелёк не подключён')}</strong><dl className="account-facts"><div><dt>{t('Версия кошелька')}</dt><dd>{verified?walletState?.walletVersion||t('Не определена'):'—'}</dd></div><div><dt>TON Proof</dt><dd>{verified?t('Подтверждён'):t('Не подтверждён')}</dd></div><div><dt>Gasless</dt><dd>{gaslessCompatible?t('Поддерживается'):t('Не поддерживается')}{gaslessCompatible&&!capabilities.gaslessCandidate?' · '+t('Сейчас недоступен'):''}</dd></div></dl></>}{walletError&&<p role="alert">{walletError}</p>}<div className="account-actions"><button className="secondary" disabled={walletBusy||!restored} onClick={()=>void reconnect()}>{t(wallet?'Переподключить':'Подключить TON-кошелёк')}</button>{wallet&&<button className="ghost" disabled={walletBusy} onClick={()=>void ui.disconnect().catch(e=>setWalletError((e as Error).message))}>{t('Отключить')}</button>}</div></article>}
   {page==='security'&&<article className="panel account-content"><h2>{t('Безопасность')}</h2><dl className="account-facts"><div><dt>{t('Аутентификация')}</dt><dd>Telegram</dd></div><div><dt>{t('Веб-сессия')}</dt><dd>{t('Активна')}</dd></div><div><dt>{t('Подключённый кошелёк')}</dt><dd>{wallet?short(wallet.account.address):t('Не подключён')}</dd></div></dl><button className="secondary" onClick={onLogout}><Icon name="logout" size={18}/>{t('Выйти из аккаунта')}</button></article>}
   {page==='notifications'&&<article className="panel account-content"><h2>{t('Уведомления')}</h2><p>{t('Настройки отображения на этом устройстве. Уведомления в Telegram пока не подключены.')}</p>{notificationKeys.map(key=><label className="account-toggle" key={key}><span>{t(key)}</span><input type="checkbox" checked={preferences[key]} onChange={()=>toggle(key)}/></label>)}</article>}
   {page==='partners'&&<Referrals account={account} bot={bot} onNotice={onNotice} onError={onError}/>}
   {page==='language'&&<article className="panel account-content"><h2>{t('Язык приложения')}</h2><label>{t('Выберите язык')}<select value={language} onChange={event=>choose(event.target.value as Language)}>{languages.map(item=><option key={item.code} value={item.code} lang={item.code}>{item.native}</option>)}</select></label><p>{t('Настройка сохраняется в вашем аккаунте.')}</p></article>}
   {page==='documents'&&<article className="panel account-content"><h2>{t('Документы')}</h2><button className="account-document" onClick={onOffer}>{t('Публичная оферта')} <Icon name="arrow" size={17}/></button><button className="account-document" onClick={onAgreement}>{t('Пользовательское соглашение')} <Icon name="arrow" size={17}/></button><button className="account-document" onClick={()=>openPage('privacy')}>{t('Политика конфиденциальности')} <Icon name="arrow" size={17}/></button><p>{t('Акцепт зафиксирован')} {account.offer.acceptedAt?new Date(account.offer.acceptedAt).toLocaleString(locale):'—'}.</p></article>}
   {page==='privacy'&&<Privacy embedded/>}
   {page==='status'&&<article className="panel account-content"><h2>{t('Состояние системы')}</h2><dl className="account-facts"><div><dt>USDT · TON</dt><dd>{t(account.paymentsEnabled?'Доступен':'Недоступен')}</dd></div><div><dt>{t('Начисления')}</dt><dd>{t(account.accrualEnabled?'Доступны':'Не активны')}</dd></div></dl></article>}
   {page==='about'&&<article className="panel account-content"><h2>AetherMind</h2><p>{t('Вычислительная сеть GPU с фиксированными тарифами и ручным рассмотрением вывода.')}</p><button className="text-button" onClick={onOffer}>{t('Открыть оферту')}</button></article>}
  </>}
 </section>;
}
