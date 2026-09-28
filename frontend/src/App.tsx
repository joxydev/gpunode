import {useLanguage} from './i18n';
import LanguagePicker from './LanguagePicker';
import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {useAmbientMotion} from './motion';
import CoreVisual from './CoreVisual';
import OwnerPanel from './OwnerPanel';
import SupportPanel from './SupportPanel';
import Market from './Market';
import Profile from './Profile';
import Dashboard from './Dashboard';
import Privacy from './Privacy';
import TonProofSync from './TonProofSync';
import {BackContext} from './navigation';
import BrowserLogin from './BrowserLogin';
import {AGREEMENT_VERSION,AgreementDocument,AgreementGate} from './Agreement';
import {OFFER_DOCUMENT_SHA256,OFFER_VERSION,OfferDocument,OfferGate} from './Offer';
import {api,setToken,savedToken,haptic,type Account} from './api';
import {Icon} from './Icons';
import './owner.css';
import './entry.css';
import './agreement.css';
import './app-v2.css';
import './space-layout.css';
import './product-layout.css';
const TonWallet=lazy(()=>import('./TonWallet'));

function Splash(){const {t}=useLanguage();const el=useRef<HTMLDivElement>(null);useEffect(()=>{if(!el.current||matchMedia('(prefers-reduced-motion: reduce)').matches)return;let cancelled=false,animation:{destroy:()=>void}|null=null;void import('lottie-web/build/player/lottie_light').then(({default:lottie})=>{if(!cancelled&&el.current)animation=lottie.loadAnimation({container:el.current,renderer:'svg',loop:true,autoplay:true,path:'/assets/splash.json'})}).catch(()=>{/* keep the still splash artwork */});return()=>{cancelled=true;animation?.destroy()}},[]);return <div className="splash"><div ref={el} className="splash-ring"/><img src="/assets/core.webp" alt={t("Нейронное ядро")} draggable={false}/><p>{t("Соединяем с AetherMind…")}</p></div>}

export default function App(){
 useAmbientMotion();
 const {t,language,chosen}=useLanguage();
 const [tab,setTab]=useState('dashboard'),[entered,setEntered]=useState(false),[bot,setBot]=useState(''),[account,setAccount]=useState<Account|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[modal,setModal]=useState(''),[accepting,setAccepting]=useState(false);
 const [profilePage,setProfilePage]=useState<'root'|'assets'>('root'),[profileRequest,setProfileRequest]=useState(0),[financeView,setFinanceView]=useState<'deposit'|'history'|null>(null),[financeRequest,setFinanceRequest]=useState(0),[childBack,setChildBack]=useState<(()=>void)|null>(null),[supportBack,setSupportBack]=useState<(()=>void)|null>(null);
 const backStack=useRef<(()=>void)[]>([]),supportStack=useRef<(()=>void)[]>([]);
 const registerBack=useCallback((handler:()=>void)=>{backStack.current.push(handler);setChildBack(()=>handler);return()=>{backStack.current=backStack.current.filter(item=>item!==handler);setChildBack(()=>backStack.current.at(-1)||null)}},[]);
 const registerSupportBack=useCallback((handler:()=>void)=>{supportStack.current.push(handler);setSupportBack(()=>handler);return()=>{supportStack.current=supportStack.current.filter(item=>item!==handler);setSupportBack(()=>supportStack.current.at(-1)||null)}},[]);
 const orderKey=useRef<string>(''),sessionGeneration=useRef(0);
 const inTelegram=Boolean(window.Telegram?.WebApp.initData),returnModal=useRef(''),modalRef=useRef<HTMLDivElement>(null);
 async function loadCatalog(){try{const c=await api('/catalog');setBot(c.botUsername)}catch{setError(t('Нет связи с API. Проверьте соединение и повторите.'))}}
 async function refresh(){const generation=sessionGeneration.current;const next=await api<Account>('/me');if(generation===sessionGeneration.current)setAccount(next)}
 async function login(){setError('');const raw=window.Telegram?.WebApp.initData;if(!raw){returnModal.current=modal;setModal('browser-login');return}setLoading(true);try{const r=await api('/auth/telegram',{initData:raw});sessionGeneration.current++;setToken(r.token);await refresh();setEntered(true)}catch(e){setError((e as Error).message)}finally{setLoading(false)}}
 useEffect(()=>{if(location.pathname==='/privacy')return;const tg=window.Telegram?.WebApp;const expand=()=>{try{tg?.expand()}catch{}};tg?.ready();expand();const retry=setTimeout(expand,350);try{tg?.setHeaderColor?.('#07080E');tg?.setBackgroundColor?.('#07080E')}catch{}void loadCatalog();if(tg?.initData)void login();else{const saved=savedToken();if(saved){setToken(saved);void refresh().then(()=>setEntered(true)).catch(()=>setToken(''))}}return()=>clearTimeout(retry)},[]);
 useEffect(()=>{const tg=window.Telegram?.WebApp,root=document.documentElement;const setInsets=()=>{const safe=tg?.safeAreaInset,content=tg?.contentSafeAreaInset;for(const side of ['top','right','bottom','left'] as const)root.style.setProperty('--app-safe-'+side,`max(env(safe-area-inset-${side}), ${Math.max(safe?.[side]||0,content?.[side]||0)}px)`)};setInsets();tg?.onEvent?.('safeAreaChanged',setInsets);tg?.onEvent?.('contentSafeAreaChanged',setInsets);return()=>{tg?.offEvent?.('safeAreaChanged',setInsets);tg?.offEvent?.('contentSafeAreaChanged',setInsets)}},[]);
 useEffect(()=>{const button=window.Telegram?.WebApp.BackButton;if(!button)return;const onBack=()=>{if(modal){if(modal==='support'&&supportBack)supportBack();else setModal('')}else childBack?.()};button.onClick(onBack);if(modal||childBack)button.show();else button.hide();return()=>{button.offClick(onBack);button.hide()}},[modal,childBack,supportBack]);
 useEffect(()=>{const button=window.Telegram?.WebApp.SettingsButton;if(!button)return;const open=()=>{setProfilePage('root');setProfileRequest(id=>id+1);setTab('profile');setEntered(true)};button.onClick(open);if(account)button.show();else button.hide();return()=>{button.offClick(open);button.hide()}},[account?.user.id]);
 useEffect(()=>{if(!account)return;const id=setInterval(()=>{if(document.visibilityState==='visible')refresh().catch(e=>setError(e.message))},30000);return()=>clearInterval(id)},[account?.user.id]);
 useEffect(()=>{if(!chosen||!account||account.user.preferredLanguage===language)return;let active=true;void api('/me/language',{language},'PATCH').then(()=>{if(active)setAccount(previous=>previous&&previous.user.id===account.user.id?{...previous,user:{...previous.user,preferredLanguage:language}}:previous)}).catch(()=>{/* retry after refresh */});return()=>{active=false}},[account?.user.id,account?.user.preferredLanguage,language,chosen]);
 useEffect(()=>{if(!modal)return;const old=document.activeElement as HTMLElement;modalRef.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setModal('');if(e.key==='Tab'){const list=modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]');if(!list?.length)return;const first=list[0],last=list[list.length-1];if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault()}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault()}}};document.addEventListener('keydown',key);const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;old?.focus()}},[modal]);
 function navigate(next:string){haptic();if(next==='profile'){setProfilePage('root');setProfileRequest(id=>id+1)}setTab(next);setEntered(true)}
 function openFinance(view:'deposit'|'history'|null){setFinanceView(view);setFinanceRequest(id=>id+1);navigate('wallet')}
 function openAssets(){haptic();setProfilePage('assets');setTab('profile');setEntered(true)}
 function logout(){sessionGeneration.current++;setToken('');setAccount(null);setEntered(false);setTab('dashboard');setModal('');setNotice('')}
 async function acceptAgreement(){setAccepting(true);setError('');try{await api('/agreement/accept',{version:AGREEMENT_VERSION});await refresh()}catch(e){setError((e as Error).message)}finally{setAccepting(false)}}
 async function acceptOffer(){setAccepting(true);setError('');try{await api('/offer/accept',{version:OFFER_VERSION,documentSha256:OFFER_DOCUMENT_SHA256,readConfirmed:true});await refresh();setNotice(t('Акцепт оферты зафиксирован в профиле.'))}catch(e){setError((e as Error).message)}finally{setAccepting(false)}}
 const alerts=<>{error&&<div className="alert error" role="alert">{error}<button aria-label={t("Закрыть")} onClick={()=>setError('')}><Icon name="close" size={18}/></button></div>}{notice&&<div className="alert" role="status">{notice}<button aria-label={t("Закрыть")} onClick={()=>setNotice('')}><Icon name="close" size={18}/></button></div>}</>;
 if(location.pathname==='/privacy')return <div className="app-shell"><Privacy/><a className="secondary" href="/">{t('Открыть платформу')}</a></div>;
 if(!chosen)return <LanguagePicker/>;
 if(loading)return <Splash/>;
 if(account&&!account.agreement.accepted)return <AgreementGate busy={accepting} error={error} onAccept={acceptAgreement}/>;
 if(account&&!account.offer.accepted)return <OfferGate busy={accepting} error={error} onAccept={acceptOffer}/>;
 return <BackContext.Provider value={registerBack}><div className="app-shell" onContextMenu={e=>{if((e.target as HTMLElement).closest('img,.core-visual'))e.preventDefault()}} onDragStart={e=>{if((e.target as HTMLElement).closest('img'))e.preventDefault()}}>
  <TonProofSync account={account} onRefresh={refresh} onError={setError}/>
  <header className="topbar"><button className="brand" onClick={()=>{setEntered(false);haptic()}} aria-label={t("AetherMind — начало")}><img src="/assets/icons/icon-72.png" alt=""/><span>Aether<span className="cyan">Mind</span><small>{t("DECENTRALIZED GPU NETWORK")}</small></span></button><button className="icon-button support-button" aria-label={`${t('Техническая поддержка')}${account?.notifications.unreadSupport?`, ${t('непрочитанных ответов:')} ${account.notifications.unreadSupport}`:''}`} onClick={()=>setModal('support')}><Icon name="help"/>{Boolean(account?.notifications.unreadSupport)&&<span className="notify-badge">{Math.min(account!.notifications.unreadSupport,99)}</span>}</button></header>
  {!modal&&alerts}
  {entered&&<nav className={`bottom-nav ${account?.user.isOwner?'owner-nav':''}`} aria-label={t("Основная навигация")}>{[...([['dashboard','grid',t('Главная')],['nodes','node',t('Тарифы')],['wallet','wallet',t('Финансы')],['profile','user',t('Профиль')]] as string[][]),...(account?.user.isOwner?[['owner','grid',t('Управление')]]:[])].map(([id,icon,label])=><button key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>navigate(id)}><Icon name={icon}/><span>{label}</span>{id==='owner'&&Boolean(account?.notifications.unreadSupport)&&<span className="nav-dot"/>}</button>)}</nav>}
  {!entered?<main className="welcome welcome-v2"><div className="eyebrow"><i/> DePIN GPU INFRASTRUCTURE</div><CoreVisual/><h1>{t("Вычислительная сеть.")}<br/><span className="gradient">{t("Ваше участие.")}</span></h1><p className="lead">{t("Выберите фиксированный тариф. AetherMind назначает оборудование, обслуживает кластер и распределяет B2B-задачи.")}</p><div className="welcome-features"><span><Icon name="shield" size={17}/> {t("Оферта № 88/2026-AI")}</span><span><Icon name="node" size={17}/> {t("Фиксированный Epoch")}</span><span><Icon name="grid" size={17}/> {t("Путь участия")}</span></div><button className="primary shimmer" onClick={()=>navigate(account?.selectedTariff?'dashboard':'nodes')}>{t(account?.selectedTariff?'Открыть платформу':'Выбрать тариф')} <Icon name="arrow"/></button>{!inTelegram&&!account&&<button className="ghost wide" onClick={()=>void login()}>{t("Войти через Telegram")}</button>}{account&&<button className="ghost wide" onClick={()=>navigate('dashboard')}>{t("Открыть платформу")}</button>}<p className="fine">{t('Пополнение USDT TON доступно через кошелёк. Заказы за реальные средства и начисления подключаются отдельно; вывод согласовывается вручную.')}</p><div className="welcome-links"><button className="text-button" onClick={()=>setModal('offer')}>{t("Публичная оферта")}</button><button className="text-button" onClick={()=>setModal('agreement')}>{t("Пользовательское соглашение")}</button><button className="text-button" onClick={()=>setModal('terms')}>{t("Как это работает")}</button><a className="text-button" href="/privacy">{t('Политика конфиденциальности')}</a></div></main>:<main className={`workspace page-${tab}`}>
   {tab==='dashboard'&&(account?<Dashboard account={account} onMarket={()=>navigate('nodes')} onFinance={()=>openFinance('deposit')} onHistory={()=>openFinance('history')} onAssets={openAssets} onOrder={()=>setModal('order')} onWithdraw={()=>setModal('withdraw')} onSupport={()=>setModal('support')}/>:<section className="empty panel account-required"><Icon name="user" size={34}/><h2>{t("Войдите в профиль")}</h2><p>{t("Авторизация через Telegram нужна, чтобы сохранять этапы и выбранный тариф.")}</p><button className="primary" onClick={()=>void login()}>{t("Войти через Telegram")}</button></section>)}
   {tab==='nodes'&&<Market authenticated={Boolean(account)} selectedId={account?.selectedTariff?.nodeId} onLogin={()=>void login()} onSelected={refresh} onNotice={setNotice} onError={setError}/>}
   {tab==='wallet'&&<Suspense fallback={<div className="panel loading-panel" role="status">{t('Загрузка…')}</div>}><TonWallet account={account} onRefresh={refresh} onLogin={()=>void login()} onSupport={()=>setModal('support')} onWithdraw={()=>setModal('withdraw')} initialView={financeView} viewRequest={financeRequest}/></Suspense>}
   {tab==='profile'&&(account?<Profile key={profileRequest} account={account} bot={bot} initialPage={profilePage} onMarket={()=>navigate('nodes')} onOffer={()=>setModal('offer')} onAgreement={()=>setModal('agreement')} onSupport={()=>setModal('support')} onLogout={logout} onNotice={setNotice} onError={setError}/>:<section className="empty panel account-required"><Icon name="user" size={34}/><h2>{t("Войдите в профиль")}</h2><button className="primary" onClick={()=>void login()}>{t("Войти через Telegram")}</button></section>)}
   {tab==='owner'&&account?.user.isOwner&&<OwnerPanel onRefresh={refresh}/>}
   <footer><button className="text-button" onClick={()=>setModal('offer')}>{t("Публичная оферта")}</button><button className="text-button" onClick={()=>setModal('agreement')}>{t("Соглашение")}</button><a className="text-button" href="/privacy">{t('Политика конфиденциальности')}</a><span>AETHERMIND / DePIN</span></footer>
  </main>}

  {modal&&<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!accepting)setModal('')}}><div className={`modal panel ${modal==='agreement'?'agreement-modal':modal==='offer'?'offer-modal':''}`} role="dialog" aria-modal="true" aria-label={t("Информация AetherMind")} tabIndex={-1} ref={modalRef}><button className="modal-close icon-button" aria-label={t("Закрыть")} onClick={()=>setModal('')}><Icon name="close"/></button>{alerts}
   {modal==='browser-login'&&<BrowserLogin onSuccess={async token=>{sessionGeneration.current++;setToken(token);await refresh();setEntered(true);setModal(returnModal.current);setNotice(t('Вход через Telegram выполнен.'))}}/>}
   {modal==='support'&&(account?<BackContext.Provider value={registerSupportBack}><SupportPanel tickets={account.tickets} onRefresh={refresh}/></BackContext.Provider>:<><h2>{t("Войдите для обращения")}</h2><button className="primary wide" onClick={()=>void login()}>{t("Войти через Telegram")}</button></>)}
   {modal==='order'&&<><Icon name="node" size={38}/><h2>{t('Заказ тарифов')}</h2><p>{t('Оформление заказа за внутренний баланс подключается отдельно. Ваш подтверждённый баланс не списывается.')}</p><button className="secondary" onClick={()=>{setModal('');navigate('wallet')}}>{t('Открыть кошелёк')}</button></>}
   {modal==='withdraw'&&<><Icon name="lock" size={38}/><h2>{t("Вывод пока недоступен")}</h2><p>{t("Вывод проводится оператором вручную после проверки заявки. Напишите в поддержку для оформления запроса; автоматические выплаты не включены.")}</p></>}
   {modal==='offer'&&<OfferDocument/>}
   {modal==='agreement'&&<AgreementDocument/>}
   {modal==='terms'&&<><span className="eyebrow">{t("ПУТЬ ПРОВАЙДЕРА НОДЫ")}</span><h2>{t("Как работает AetherMind")}</h2><ol><li>{t("Регистрация через Telegram и однократный акцепт документов.")}</li><li>{t("Выбор фиксированного тарифа по оферте.")}</li><li>{t("Пополнение USDT в сети TON через TON Connect.")}</li><li>{t("Заказ слота: Оператор назначает оборудование и запускает Epoch.")}</li><li>{t("После завершения Epoch запрос на вывод рассматривается оператором вручную.")}</li></ol><p>{t("Пользователь не выбирает режим производительности или задачи. Оператор управляет инфраструктурой и распределением B2B-нагрузки.")}</p></>}
  </div></div>}
 </div></BackContext.Provider>
}
