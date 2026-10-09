import {useLanguage} from './i18n';
import LanguagePicker from './LanguagePicker';
import {lazy,Suspense,useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useAmbientMotion,useAppActive,useReducedMotion,useSurfaceMotion,exitSurface} from './motion';
import CoreVisual from './CoreVisual';
const OwnerPanel=lazy(()=>import('./OwnerPanel'));
const SupportPanel=lazy(()=>import('./SupportPanel'));
const NotificationsCenter=lazy(()=>import('./NotificationsCenter'));
import Market from './Market';
import Profile from './Profile';
import Dashboard from './Dashboard';
import Privacy from './Privacy';
import TonProofSync from './TonProofSync';
import {BackContext} from './navigation';
import {useViewport} from './viewport';
import BrowserLogin from './BrowserLogin';
import {AGREEMENT_VERSION,AgreementDocument,AgreementGate} from './Agreement';
import {OFFER_DOCUMENT_SHA256,OFFER_VERSION,OfferDocument,OfferGate} from './Offer';
import {api,setToken,savedToken,haptic,responseTiming,apiRevision,type Account} from './api';
import {Icon} from './Icons';
import {serverClock} from './live-accrual';
import './owner.css';
import './entry.css';
import './agreement.css';
import './app-v2.css';
const ProductTour=lazy(()=>import('./ProductTour'));
const TonWallet=lazy(()=>import('./TonWallet'));
const Withdrawals=lazy(()=>import('./Withdrawals'));

function Splash(){const {t}=useLanguage(),active=useAppActive(),reduced=useReducedMotion();const el=useRef<HTMLDivElement>(null);useEffect(()=>{if(!el.current||!active||reduced)return;let cancelled=false,animation:{destroy:()=>void}|null=null;void import('lottie-web/build/player/lottie_light').then(({default:lottie})=>{if(!cancelled&&el.current)animation=lottie.loadAnimation({container:el.current,renderer:'svg',loop:true,autoplay:true,path:'/assets/splash.json'})}).catch(()=>{/* keep the still splash artwork */});return()=>{cancelled=true;animation?.destroy()}},[active,reduced]);return <div className="splash"><div ref={el} className="splash-ring"/><img src="/assets/core.webp" alt={t("Нейронное ядро")} draggable={false}/><p>{t("Соединяем с AetherMind…")}</p></div>}

export default function App(){
 useAmbientMotion();
 useViewport();
 const appActive=useAppActive();useEffect(()=>serverClock.setActive(appActive),[appActive]);
 const {t,language,chosen}=useLanguage();
 const [tab,setTab]=useState('dashboard'),[entered,setEntered]=useState(false),[tourOpen,setTourOpen]=useState(false),[marketIntent,setMarketIntent]=useState<{id:string|null;review:boolean;nonce:number}>({id:null,review:false,nonce:0}),[bot,setBot]=useState(''),[account,setAccount]=useState<Account|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[modal,setModal]=useState(''),[accepting,setAccepting]=useState(false);
 const [walletVisited,setWalletVisited]=useState(false);
 const [desktop,setDesktop]=useState(()=>matchMedia('(min-width:1024px)').matches);
 useEffect(()=>{const query=matchMedia('(min-width:1024px)'),update=()=>setDesktop(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update)},[]);
 const surfaceRef=useRef<HTMLDivElement>(null),workspaceRef=useRef<HTMLElement>(null),navRef=useRef<HTMLElement>(null),ownerReturnScroll=useRef(0);
 const pageIntent=useRef<{top:number;id?:string}|null>(null),[pageTransition,setPageTransition]=useState(0);
 useLayoutEffect(()=>{
  const intent=pageIntent.current,workspace=surfaceRef.current?.querySelector<HTMLElement>('.workspace:not([hidden])');
  if(!intent||!workspace)return;
  const apply=()=>{
   const target=intent.id?document.getElementById(intent.id):Array.from(workspace.querySelectorAll<HTMLElement>('h1')).find(el=>el.getClientRects().length);
   if(!target?.getClientRects().length)return false;
   pageIntent.current=null;window.scrollTo({top:intent.top});target.focus({preventScroll:true});return true;
  };
  if(apply())return;
  const observer=new MutationObserver(()=>{if(apply())observer.disconnect()});observer.observe(workspace,{childList:true,subtree:true});return()=>observer.disconnect();
 },[pageTransition]);
 useEffect(()=>{const nav=navRef.current;if(!nav||!entered)return;const update=()=>document.documentElement.style.setProperty('--app-nav-height',nav.getBoundingClientRect().height+'px');update();const observer=new ResizeObserver(update);observer.observe(nav);return()=>observer.disconnect()},[entered,desktop,account?.user.isOwner]);
 const [profilePage,setProfilePage]=useState<'root'|'assets'|'activity'>('root'),[profileRequest,setProfileRequest]=useState(0),[financeView,setFinanceView]=useState<'deposit'|null>(null),[financeRequest,setFinanceRequest]=useState(0),[childBack,setChildBack]=useState<(()=>void)|null>(null),[supportBack,setSupportBack]=useState<(()=>void)|null>(null);
 const [assetIntent,setAssetIntent]=useState<string|null>(null),gpuReturn=useRef<{tab:string;top:number;id:string}|null>(null);
 const [activityReference,setActivityReference]=useState<{type:string;id:string}|null>(null),[supportTicketId,setSupportTicketId]=useState('');
 const [supportReference,setSupportReference]=useState<{referenceType:'DEPOSIT'|'WITHDRAWAL';referenceId:string;invoiceId?:string}|null>(null);
 const backStack=useRef<(()=>void)[]>([]),supportStack=useRef<(()=>void)[]>([]);
 const registerBack=useCallback((handler:()=>void)=>{backStack.current.push(handler);setChildBack(()=>handler);return()=>{backStack.current=backStack.current.filter(item=>item!==handler);setChildBack(()=>backStack.current.at(-1)||null)}},[]);
 const registerSupportBack=useCallback((handler:()=>void)=>{supportStack.current.push(handler);setSupportBack(()=>handler);return()=>{supportStack.current=supportStack.current.filter(item=>item!==handler);setSupportBack(()=>supportStack.current.at(-1)||null)}},[]);
 const orderKey=useRef<string>(''),sessionGeneration=useRef(0);
 const inTelegram=Boolean(window.Telegram?.WebApp.initData),returnModal=useRef(''),modalRef=useRef<HTMLDivElement>(null);
 const exitCancel=useRef<(()=>void)|null>(null),closing=useRef(false);
 useSurfaceMotion(workspaceRef,pageTransition);useSurfaceMotion(modalRef,modal,'modal');
 useLayoutEffect(()=>{exitCancel.current?.();exitCancel.current=null;closing.current=false;return()=>exitCancel.current?.()},[modal,tourOpen]);
 function closeTour(){if(closing.current)return;closing.current=true;exitCancel.current=exitSurface(document.querySelector('.tour-panel'),()=>setTourOpen(false));}
 async function loadCatalog(){try{const c=await api('/catalog');setBot(c.botUsername)}catch{setError(t('Нет связи с API. Проверьте соединение и повторите.'))}}
 const refreshFlight=useRef<{generation:number;promise:Promise<void>}|null>(null);
 const refresh=useCallback(()=>{
  const generation=sessionGeneration.current;if(refreshFlight.current?.generation===generation)return refreshFlight.current.promise;
  const promise=(async()=>{let revision:number,next:Account;do{revision=apiRevision();next=await api<Account>('/me');}while(revision!==apiRevision()&&generation===sessionGeneration.current);
   if(generation!==sessionGeneration.current)return;const timing=responseTiming.get(next);
   if(next.serverNow&&timing&&!serverClock.sync(next.serverNow,timing.sent,timing.received))return;setAccount(next);
  })();refreshFlight.current={generation,promise};void promise.finally(()=>{if(refreshFlight.current?.promise===promise)refreshFlight.current=null}).catch(()=>{});return promise;
 },[]);
 async function login(){setError('');const raw=window.Telegram?.WebApp.initData;if(!raw){returnModal.current=modal;setModal('browser-login');return}setLoading(true);try{const r=await api('/auth/telegram',{initData:raw});sessionGeneration.current++;setToken(r.token);await refresh()}catch(e){setError((e as Error).message)}finally{setLoading(false)}}
 useEffect(()=>{if(location.pathname==='/privacy')return;const tg=window.Telegram?.WebApp;const expand=()=>{try{tg?.expand()}catch{}};tg?.ready();expand();const retry=setTimeout(expand,350);try{tg?.setHeaderColor?.('#080D17');tg?.setBackgroundColor?.('#080D17')}catch{}void loadCatalog();if(tg?.initData)void login();else{const saved=savedToken();if(saved){setToken(saved);void refresh().catch(()=>setToken(''))}}return()=>clearTimeout(retry)},[]);
 useEffect(()=>{const tg=window.Telegram?.WebApp,root=document.documentElement;const setInsets=()=>{const safe=tg?.safeAreaInset,content=tg?.contentSafeAreaInset;for(const side of ['top','right','bottom','left'] as const)root.style.setProperty('--app-safe-'+side,`max(env(safe-area-inset-${side}), ${Math.max(safe?.[side]||0,content?.[side]||0)}px)`)};setInsets();tg?.onEvent?.('safeAreaChanged',setInsets);tg?.onEvent?.('contentSafeAreaChanged',setInsets);return()=>{tg?.offEvent?.('safeAreaChanged',setInsets);tg?.offEvent?.('contentSafeAreaChanged',setInsets)}},[]);

 useEffect(()=>{const button=window.Telegram?.WebApp.BackButton;if(!button)return;const onBack=()=>{if(tourOpen)closeTour();else if(modal){if(modal==='support'&&supportBack)supportBack();else dismissModal()}else if(childBack)childBack();else if(tab==='owner')returnFromOwner()};button.onClick(onBack);if(tourOpen||modal||childBack||(entered&&tab==='owner'))button.show();else button.hide();return()=>{button.offClick(onBack);button.hide()}},[tourOpen,modal,childBack,supportBack,tab,entered]);
 useEffect(()=>{const button=window.Telegram?.WebApp.SettingsButton;if(!button)return;const open=()=>{setAssetIntent(null);setProfilePage('root');setProfileRequest(id=>id+1);setTab('profile');setEntered(true)};button.onClick(open);if(account)button.show();else button.hide();return()=>{button.offClick(open);button.hide()}},[account?.user.id]);
 useEffect(()=>{
  if(!account)return;let pending=false,last=0;
  const update=()=>{if(pending||document.visibilityState==='hidden'||window.Telegram?.WebApp.isActive===false||performance.now()-last<1000)return;pending=true;last=performance.now();void refresh().catch(e=>setError(e.message)).finally(()=>{pending=false})};
  const visibility=()=>{serverClock.setActive(document.visibilityState==='visible'&&window.Telegram?.WebApp.isActive!==false);if(document.visibilityState==='visible')update()};const tg=window.Telegram?.WebApp;
  const activated=()=>{serverClock.setActive(true);update()},deactivated=()=>serverClock.setActive(false);
  const id=setInterval(update,30000);document.addEventListener('visibilitychange',visibility);window.addEventListener('pageshow',update);tg?.onEvent?.('activated',activated);tg?.onEvent?.('deactivated',deactivated);
  return()=>{clearInterval(id);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pageshow',update);tg?.offEvent?.('activated',activated);tg?.offEvent?.('deactivated',deactivated)};
 },[account?.user.id,refresh]);
 useEffect(()=>{const expired=()=>{sessionGeneration.current++;serverClock.reset();setToken('');setAccount(null);setEntered(false);setModal('');setError(t('Сессия истекла. Войдите снова.'))};window.addEventListener('aethermind:session-expired',expired);return()=>window.removeEventListener('aethermind:session-expired',expired)},[language]);
 useEffect(()=>{if(!chosen||!account||account.user.preferredLanguage===language)return;let active=true;void api('/me/language',{language},'PATCH').then(()=>{if(active)setAccount(previous=>previous&&previous.user.id===account.user.id?{...previous,user:{...previous.user,preferredLanguage:language}}:previous)}).catch(()=>{/* retry after refresh */});return()=>{active=false}},[account?.user.id,account?.user.preferredLanguage,language,chosen]);
 useEffect(()=>{if(!modal)return;const old=document.activeElement as HTMLElement;modalRef.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();dismissModal()}if(e.key==='Tab'){const list=modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]');if(!list?.length)return;const first=list[0],last=list[list.length-1];if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault()}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault()}}};document.addEventListener('keydown',key);const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;old?.focus()}},[modal]);
 function startPage(intent:{top:number;id?:string}={top:0}){pageIntent.current=intent;setPageTransition(id=>id+1)}
 function navigate(next:string){haptic();if(next==='profile'){setAssetIntent(null);setProfilePage('root');setProfileRequest(id=>id+1)}if(next==='wallet')setWalletVisited(true);setTab(next);setEntered(true);startPage()}
 function openOwner(){ownerReturnScroll.current=window.scrollY;navigate('owner')}
 function returnFromOwner(){setAssetIntent(null);setProfilePage('root');setProfileRequest(id=>id+1);setTab('profile');startPage({top:ownerReturnScroll.current,id:'profile-owner-entry'})}
 function dismissModal(){if(accepting||closing.current||modalRef.current?.querySelector('[aria-busy=true]'))return;closing.current=true;exitCancel.current=exitSurface(modalRef.current,()=>setModal(''))}
 useEffect(()=>{if(surfaceRef.current)surfaceRef.current.inert=Boolean(modal||tourOpen)},[modal,tourOpen]);
 function openOrder(){if(!account?.selectedTariff){navigate('nodes');return}setMarketIntent(old=>({id:account.selectedTariff!.nodeId,review:true,nonce:old.nonce+1}));navigate('nodes')}
 function openFinance(view:'deposit'|null){setFinanceView(view);setFinanceRequest(id=>id+1);navigate('wallet')}
 function openSupport(reference?:{referenceType:'DEPOSIT'|'WITHDRAWAL';referenceId:string;invoiceId?:string}){setSupportReference(reference||null);setSupportTicketId('');setModal('support')}
 function openAssets(leaseId?:string){gpuReturn.current=leaseId?{tab,top:window.scrollY,id:(document.activeElement as HTMLElement)?.id||''}:null;setAssetIntent(leaseId||null);haptic();setProfilePage('assets');setProfileRequest(id=>id+1);setTab('profile');setEntered(true);startPage()}
 function returnFromGpu(){const previous=gpuReturn.current;if(!previous)return;setAssetIntent(null);setTab(previous.tab);startPage({top:previous.top,id:previous.id});}
 function openActivity(reference:{type:string;id:string}|null=null){setActivityReference(reference);haptic();setProfilePage('activity');setProfileRequest(id=>id+1);setTab('profile');setEntered(true);startPage()}
 function logout(){sessionGeneration.current++;serverClock.reset();setToken('');setAccount(null);setEntered(false);setTab('dashboard');setModal('');setTourOpen(false);setNotice('')}
 async function acceptAgreement(){setAccepting(true);setError('');try{await api('/agreement/accept',{version:AGREEMENT_VERSION});await refresh()}catch(e){setError((e as Error).message)}finally{setAccepting(false)}}
 async function acceptOffer(){setAccepting(true);setError('');try{await api('/offer/accept',{version:OFFER_VERSION,documentSha256:OFFER_DOCUMENT_SHA256,readConfirmed:true});await refresh();setNotice(t('Акцепт оферты зафиксирован в профиле.'))}catch(e){setError((e as Error).message)}finally{setAccepting(false)}}
 const alerts=<>{error&&<div className="alert error" role="alert">{error}<button aria-label={t("Закрыть")} onClick={()=>setError('')}><Icon name="close" size={18}/></button></div>}{notice&&<div className="alert" role="status">{notice}<button aria-label={t("Закрыть")} onClick={()=>setNotice('')}><Icon name="close" size={18}/></button></div>}</>;
 if(location.pathname==='/privacy')return <div className="app-shell"><Privacy/><a className="secondary" href="/">{t('Мои инвестиции')}</a></div>;
 if(!chosen)return <LanguagePicker/>;
 if(loading)return <Splash/>;
 if(entered&&account&&!account.agreement.accepted)return <AgreementGate busy={accepting} error={error} onAccept={acceptAgreement}/>;
 if(entered&&account&&!account.offer.accepted)return <OfferGate busy={accepting} error={error} onAccept={acceptOffer}/>;
 return <BackContext.Provider value={registerBack}><div className={'app-shell '+(entered?'app-entered':'')+(inTelegram?' telegram-shell':'')} onContextMenu={e=>{if((e.target as HTMLElement).closest('img,.core-visual'))e.preventDefault()}} onDragStart={e=>{if((e.target as HTMLElement).closest('img'))e.preventDefault()}}>
  <TonProofSync account={account} onRefresh={refresh} onError={setError}/>
  <div className="app-surface" ref={surfaceRef}>
  <header className="topbar"><button className="brand" onClick={()=>{setEntered(false);haptic()}} aria-label={t("AetherMind — начало")}><img src="/assets/icons/icon-72.png" alt=""/><span>Aether<span className="cyan">Mind</span><small>{t("DECENTRALIZED GPU NETWORK")}</small></span></button>{account&&<button className="icon-button support-button" aria-label={`${t('Уведомления')}: ${account.notifications.unread||0}`} onClick={()=>setModal('notifications')}><Icon name="bell"/>{Boolean(account.notifications.unread)&&<span className="notify-badge">{Math.min(account.notifications.unread,99)}</span>}</button>}<button className="icon-button support-button" aria-label={`${t('Техническая поддержка')}${account?.notifications.unreadSupport?`, ${t('непрочитанных ответов:')} ${account.notifications.unreadSupport}`:''}`} onClick={()=>openSupport()}><Icon name="help"/>{Boolean(account?.notifications.unreadSupport)&&<span className="notify-badge">{Math.min(account!.notifications.unreadSupport,99)}</span>}</button></header>
  {!modal&&alerts}
  {entered&&<nav ref={navRef} className="app-nav" aria-label={t('Основная навигация')}>{[['dashboard','home','Главная'],['nodes','node','Тарифы'],['wallet','wallet','Финансы'],['profile','user','Профиль']].map(([id,icon,label])=><button key={id} className={(tab===id||(tab==='owner'&&id==='profile'))?'active':''} aria-current={(tab===id||(!desktop&&tab==='owner'&&id==='profile'))?'page':undefined} onClick={()=>navigate(id)}><Icon name={icon} size={24}/><span>{t(label)}</span>{id==='profile'&&account?.user.isOwner&&Boolean(account.notifications.unreadSupport)&&<span className="nav-dot"/>}</button>)}{account?.user.isOwner&&<button className={'desktop-owner '+(tab==='owner'?'active':'')} aria-current={tab==='owner'?'page':undefined} onClick={openOwner}><Icon name="settings" size={24}/><span>{t('Управление')}</span>{Boolean(account.notifications.unreadSupport)&&<span className="nav-dot"/>}</button>}</nav>}
  {!entered&&<main className="welcome welcome-v2"><div className="eyebrow"><i/> DePIN GPU INFRASTRUCTURE</div><CoreVisual activeView={!modal&&!tourOpen}/><h1>{t("Вычислительная сеть.")}<br/><span className="gradient">{t("Ваше участие.")}</span></h1><p className="lead">{t("Выберите фиксированный тариф. AetherMind назначает оборудование, обслуживает кластер и распределяет B2B-задачи.")}</p><div className="welcome-features"><span><Icon name="shield" size={17}/> {t("Оферта № 88/2026-AI")}</span><span><Icon name="node" size={17}/> {t("Фиксированный срок работы")}</span><span><Icon name="grid" size={17}/> {t("Путь участия")}</span></div><button className="primary" onClick={()=>navigate('dashboard')}>{t('Мои инвестиции')} <Icon name="arrow"/></button>{!inTelegram&&!account&&<button className="ghost wide" onClick={()=>void login()}>{t("Войти через Telegram")}</button>}<div className="welcome-links"><button className="text-button" onClick={()=>setModal('offer')}>{t("Публичная оферта")}</button><button className="text-button" onClick={()=>setModal('agreement')}>{t("Пользовательское соглашение")}</button><button className="text-button" onClick={()=>setTourOpen(true)}>{t("Как это работает")}</button><a className="text-button" href="/privacy">{t('Политика конфиденциальности')}</a></div></main>}<main ref={workspaceRef} hidden={!entered} className={`workspace page-${tab}`}>
   {tab==='dashboard'&&<Dashboard account={account} onMarket={()=>navigate('nodes')} onFinance={()=>openFinance('deposit')} onAssets={openAssets} onRefresh={refresh} onOrder={openOrder} onWithdraw={()=>setModal('withdraw')} onSupport={()=>openSupport()} onTour={()=>setTourOpen(true)} onLogin={()=>void login()} onOffer={()=>setModal('offer')}/>}
   {tab==='nodes'&&<Market authenticated={Boolean(account)} account={account} selectedId={account?.selectedTariff?.nodeId} onLogin={()=>void login()} onSelected={refresh} onNotice={setNotice} onError={setError} focusNodeId={marketIntent.id} reviewRequest={marketIntent.review?marketIntent.nonce:0} onPurchased={()=>navigate('dashboard')}/>}
   {(walletVisited||tab==='wallet')&&<div className="finance-screen" hidden={tab!=='wallet'}><Suspense fallback={<div className="panel loading-panel" role="status">{t('Загрузка…')}</div>}><TonWallet key={account?.user.id||'guest'} active={tab==='wallet'&&entered} account={account} onRefresh={refresh} onLogin={()=>void login()} onSupport={openSupport} onWithdraw={()=>setModal('withdraw')} onHistory={()=>openActivity()} initialView={financeView} viewRequest={financeRequest}/></Suspense></div>}
   {tab==='profile'&&(account?<Profile key={profileRequest} account={account} bot={bot} initialPage={profilePage} initialLeaseId={assetIntent} onGpuReturn={returnFromGpu} activityReference={activityReference} onMarket={()=>navigate('nodes')} onFinance={()=>openFinance(null)} onOwner={openOwner} onOffer={()=>setModal('offer')} onAgreement={()=>setModal('agreement')} onSupport={openSupport} onNotifications={()=>setModal('notifications')} onLogout={logout} onNotice={setNotice} onError={setError} onRefresh={refresh}/>:<section className="empty panel account-required"><Icon name="user" size={34}/><h2>{t("Войдите в профиль")}</h2><button className="primary" onClick={()=>void login()}>{t("Войти через Telegram")}</button></section>)}
   {tab==='owner'&&account?.user.isOwner&&<Suspense fallback={<div className="panel loading-panel" role="status">{t('Загрузка…')}</div>}><OwnerPanel ownerId={account.user.id} onRefresh={refresh} onBack={returnFromOwner}/></Suspense>}
   <footer><button className="text-button" onClick={()=>setModal('offer')}>{t("Публичная оферта")}</button><button className="text-button" onClick={()=>setModal('agreement')}>{t("Соглашение")}</button><a className="text-button" href="/privacy">{t('Политика конфиденциальности')}</a><span>AETHERMIND / DePIN</span></footer>
  </main>
  </div>

  {modal&&<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)dismissModal()}}><div className={`modal panel ${modal==='agreement'?'agreement-modal':modal==='offer'?'offer-modal':modal==='withdraw'?'withdraw-modal':modal==='support'?'support-modal':''}`} role="dialog" aria-modal="true" aria-label={t(modal==='withdraw'?'Вывод средств':modal==='support'?'Поддержка':modal==='notifications'?'Уведомления':modal==='offer'?'Публичная оферта':modal==='agreement'?'Пользовательское соглашение':'Войти через Telegram')} tabIndex={-1} ref={modalRef}><button className="modal-close icon-button" aria-label={t("Закрыть")} onClick={dismissModal}><Icon name="close"/></button>{alerts}
   {modal==='browser-login'&&<BrowserLogin onSuccess={async token=>{sessionGeneration.current++;setToken(token);await refresh();setEntered(true);setModal(returnModal.current);setNotice(t('Вход через Telegram выполнен.'))}}/>}
   {modal==='support'&&(account?<BackContext.Provider value={registerSupportBack}><Suspense fallback={<p role="status">{t('Загрузка…')}</p>}><SupportPanel key={supportReference?.referenceId||'general'} tickets={account.tickets} reference={supportReference} initialTicketId={supportTicketId} onRefresh={refresh}/></Suspense></BackContext.Provider>:<><h2>{t("Войдите для обращения")}</h2><button className="primary wide" onClick={()=>void login()}>{t("Войти через Telegram")}</button></>)}
   {modal==='notifications'&&account&&<Suspense fallback={<p role="status">{t('Загрузка…')}</p>}><NotificationsCenter onRefresh={refresh} userId={account.user.id} onReference={(type,id)=>{setModal('');if(type==='SUPPORT'){openSupport();setSupportTicketId(id)}else openActivity({type,id})}}/></Suspense>}
   {modal==='withdraw'&&(account?<Suspense fallback={<p role="status">{t('Загрузка…')}</p>}><Withdrawals balance={account.balance} lockedBase={account.lockedBase} lockedCompound={account.lockedCompound} leases={account.activeNodes} onBack={dismissModal} onRefresh={refresh} onSupport={reference=>openSupport(reference)}/></Suspense>:<button className="primary" onClick={()=>void login()}>{t('Войти через Telegram')}</button>)}

   {modal==='offer'&&<OfferDocument/>}
   {modal==='agreement'&&<AgreementDocument/>}

  </div></div>}
 {tourOpen&&<Suspense fallback={null}><ProductTour onClose={closeTour} onMarket={()=>navigate('nodes')}/></Suspense>}
  </div></BackContext.Provider>
}
