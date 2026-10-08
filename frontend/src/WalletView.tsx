import {useCallback,useEffect,useRef,useState} from 'react';
import {useTonConnectUI,useTonWallet,useIsConnectionRestored} from '@tonconnect/ui-react';
import {useLanguage,intlLocale} from './i18n';
import {api,type Account} from './api';
import {Icon} from './Icons';
import {PageHeader,QuickAction,ListRow,Money,StatusPill} from './UI';
import {exactMoney,normalizeCreditAmount} from './exact-money';
import {tonCapabilities} from './ton-capabilities';
import {useAppBack} from './navigation';
import './ton-wallet.css';
type SupportReference={referenceType:'DEPOSIT'|'WITHDRAWAL';referenceId:string;invoiceId?:string};

type WalletState={balance:string;connectedWallet:string|null;rawAddress:string|null;verified:boolean;walletVersion:string|null;gaslessAvailable:boolean;paymentCanary:boolean;depositsEnabled:boolean;publicDepositsEnabled:boolean;minAmount:string;maxAmount:string;pending:number};
type Deposit={id:string;invoiceId:string;amount:string;receivedAmount:string|null;status:string;sender:string;recipient:string;jettonMaster:string;txHash:string|null;traceId:string|null;gaslessSigned?:boolean;createdAt:string;expiresAt:string;confirmedAt:string|null;creditedAt:string|null};
type Transaction={network:'-239';from:string;validUntil:number;messages:{address:string;amount:string;payload:string}[]};
type StructuredTransaction={network:'-239';from:string;validUntil:number;items:{type:'jetton';master:string;destination:string;amount:string;responseDestination:string;forwardAmount:string;forwardPayload:string;queryId:string}[]};
type GaslessQuote={estimateId:string;feeUsdt:string;amountUsdt:string;totalUsdt:string;expiresAt:number;signRequest:Transaction};
const short=(address:string)=>address.slice(0,7)+'…'+address.slice(-5);
const amount=(value:string,locale:string)=>exactMoney(value,locale);
const amount6=amount;
const labels:Record<string,string>={PENDING:'Ожидаем перевод',DETECTED:'Обнаружен',CONFIRMED:'Подтверждён',CREDITED:'Зачислен',EXPIRED:'Время счёта истекло',FAILED:'Ошибка',REJECTED:'Отклонён',MANUAL_REVIEW:'Ручная проверка',CANCELLED:'Счёт отменён'};

export default function WalletView({account,onRefresh,onLogin,onSupport,onWithdraw,onHistory,active=true,initialView,viewRequest}:{account:Account|null;onRefresh:()=>Promise<void>;onLogin:()=>void;onSupport:(reference?:SupportReference)=>void;onWithdraw:()=>void;onHistory:()=>void;active?:boolean;initialView:'deposit'|null;viewRequest:number}){
 const {t,language}=useLanguage(),locale=intlLocale(language);
 const [ui]=useTonConnectUI(),wallet=useTonWallet(),restored=useIsConnectionRestored();
 const [state,setState]=useState<WalletState|null>(null),[selected,setSelected]=useState<Deposit|null>(null),[step,setStep]=useState<'LIST'|'AMOUNT'|'GASLESS_REVIEW'|'WAITING'>('LIST'),[value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 const [standard,setStandard]=useState<Transaction|StructuredTransaction|null>(null),[quote,setQuote]=useState<GaslessQuote|null>(null),[manualStandard,setManualStandard]=useState(false),[signUnsupported,setSignUnsupported]=useState(false);
 const maskKey='aethermind.balance-hidden.'+(account?.user.id||'guest');
 const [masked,setMasked]=useState(()=>{try{return localStorage.getItem(maskKey)==='true'}catch{return false}});
 function toggleBalance(){setMasked(value=>{try{localStorage.setItem(maskKey,String(!value))}catch{}return !value})}
 const signedBoc=useRef<string|null>(null);
 const creditedSeen=useRef(new Set<string>()),initialized=useRef(false);
 const refresh=useCallback(async()=>{if(!account)return;const [w,h]=await Promise.all([api<WalletState>('/v1/wallet'),api<{items:Deposit[]}>('/v1/wallet/transactions')]);setState(w);setSelected(prev=>prev?h.items.find(d=>d.id===prev.id)||prev:prev);
  const credited=h.items.filter(d=>d.status==='CREDITED'&&!creditedSeen.current.has(d.id));
  for(const item of credited)creditedSeen.current.add(item.id);
  if(initialized.current&&credited.length)void onRefresh().catch(()=>{});
  initialized.current=true;
 },[account?.user.id,account?.updatedAt]);
 useEffect(()=>{void refresh().catch(e=>setError((e as Error).message))},[refresh]);
 useEffect(()=>{const id=setInterval(()=>{if(document.visibilityState==='visible')void refresh().catch(()=>{})},10000);return()=>clearInterval(id)},[refresh]);
 useEffect(()=>{if(!viewRequest)return;if(initialView==='deposit'&&account)setStep('AMOUNT')},[viewRequest]);
 useAppBack(active&&(step!=='LIST'||Boolean(selected)),()=>{if(busy)return;if(step!=='LIST')setStep('LIST');else setSelected(null)});
 async function connect(){if(!account){onLogin();return}setBusy(true);setError('');try{
   ui.setConnectRequestParameters({state:'loading'});
   const nonce=await api<{payload:string}>('/v1/ton/proof/payload',{});
   ui.setConnectRequestParameters({state:'ready',value:{tonProof:nonce.payload}});
   if(wallet)await ui.disconnect();
   await ui.openModal();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const capabilities=tonCapabilities(wallet,state?.walletVersion,state?.gaslessAvailable||false);
 useEffect(()=>setSignUnsupported(false),[wallet?.account.address]);
 async function standardPay(){if(busy||!standard||!selected||selected.status!=='PENDING'||selected.gaslessSigned||signedBoc.current)return;setBusy(true);setError('');setManualStandard(false);setStep('WAITING');
  try{await ui.sendTransaction(standard);}catch(e){setError((e as Error).message);setManualStandard(true)}finally{setBusy(false)}
 }
 async function gaslessPay(){if(busy||!quote||!selected||selected.status!=='PENDING')return;setBusy(true);setError('');setStep('WAITING');
  try{
   if(quote.expiresAt<=Math.floor(Date.now()/1000))throw Error(t('Оценка комиссии истекла. Отмените счёт и создайте новый.'));
   // signMessage signs only. Never switch to a second economic transfer after a signed result.
   const result=await ui.signMessage(quote.signRequest);
   signedBoc.current=result.internalBoc;
   await api('/v1/deposits/'+selected.id+'/gasless/send',{estimateId:quote.estimateId,internalBoc:result.internalBoc,...(result.traceId?{signTraceId:result.traceId}:{})});
   await refresh();
  }catch(e){const code=(e as {code?:number|string}).code;if(!signedBoc.current&&String(code)==='400'){setSignUnsupported(true);setError(t('Кошелёк не поддерживает подпись без GRAM. Доступен обычный перевод.'))}else if(!signedBoc.current&&String(code)==='300'){setError(t('Перевод отменён в кошельке. Можно повторить или выбрать обычный перевод.'))}else setError((e as Error).message);if(!signedBoc.current)setManualStandard(true)}finally{setBusy(false)}
 }
 async function retryGasless(){if(busy||!quote||!selected||!signedBoc.current)return;setBusy(true);setError('');
  try{await api('/v1/deposits/'+selected.id+'/gasless/send',{estimateId:quote.estimateId,internalBoc:signedBoc.current});await refresh()}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function pay(){if(busy||!state?.depositsEnabled||!wallet)return;const normalized=normalizeCreditAmount(value);if(!normalized){setError(t('Введите положительную сумму USDT, до шести знаков после запятой.'));return}setBusy(true);setError('');setManualStandard(false);signedBoc.current=null;
  try{
   const created=await api<{deposit:Deposit;transaction:Transaction;structuredTransaction:StructuredTransaction|null}>('/v1/deposits',{asset:'USDT',network:'TON',amount:normalized});
   const standardTransaction=capabilities.supportsStructuredJetton&&created.structuredTransaction?created.structuredTransaction:created.transaction;
   setSelected(created.deposit);setStandard(standardTransaction);
   if(capabilities.gaslessCandidate&&!signUnsupported){
    try{const estimate=await api<GaslessQuote>('/v1/deposits/'+created.deposit.id+'/gasless/estimate',{});setQuote(estimate);setStep('GASLESS_REVIEW')}
    catch(e){setError((e as Error).message);setStep('WAITING');setManualStandard(true)}
   }else{
    setStep('WAITING');
    // Wallet confirmation is submission only. Watcher credits on-chain settlement.
    try{await ui.sendTransaction(standardTransaction)}catch(e){setError((e as Error).message);setManualStandard(true)}
   }
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function cancel(){if(!selected||selected.status!=='PENDING'||busy)return;setBusy(true);setError('');
  try{await api('/v1/deposits/'+selected.id+'/cancel',{});await refresh();setStep('LIST')}
  catch(e){setError((e as Error).message);await refresh().catch(()=>{})}
  finally{setBusy(false)}
 }
 const verified=Boolean(wallet&&wallet.account.chain==='-239'&&state?.verified&&
   (wallet.account.address===state.rawAddress||wallet.account.address===state.connectedWallet));
 return <section className={'ton-wallet wallet-flow-'+step.toLowerCase()} aria-busy={busy}>
  <PageHeader title={t('Финансы')} subtitle={t('USDT в сети TON')}/>
  {error&&<div className="alert error" role="alert">{error}<button aria-label={t('Закрыть')} onClick={()=>setError('')}><Icon name="close" size={18}/></button><button className="text-button wallet-retry" onClick={()=>void refresh().then(()=>setError('')).catch(e=>setError((e as Error).message))}>{t('Повторить')}</button></div>}
  <div className="wallet-overview"><article className="panel balance-card"><div className="balance-top"><span>{t('Доступный баланс')}</span><button className="icon-button" onClick={toggleBalance} aria-label={t(masked?'Показать баланс':'Скрыть баланс')} aria-pressed={masked}><Icon name={masked?'eyeOff':'eye'}/></button></div><div className={'balance '+((state?.balance||account?.balance||'0').length>15?'long-balance':'')} aria-live="polite">{masked?<b aria-label={t('Баланс скрыт')}>••••••</b>:<Money value={state?.balance||account?.balance||'0'}/>}</div><div className="finance-quick-actions"><QuickAction icon="download" label={t('Пополнить')} disabled={Boolean(state&&!state.depositsEnabled)} onClick={()=>{if(!account)onLogin();else if(!verified)void connect();else setStep('AMOUNT')}}/><QuickAction icon="send" label={t('Вывести')} onClick={onWithdraw}/><QuickAction icon="history" label={t('История')} onClick={onHistory}/></div><p className="wallet-balance-note">{t('Баланс платформы — учётная запись. USDT хранятся на кошельке сервиса.')}</p></article><div className="wallet-information"><div className="ui-list-group wallet-connect"><ListRow icon="wallet" title={t('Подключённый кошелёк')} value={wallet?short(wallet.account.address):t('Не подключён')}/><ListRow icon="network" title={t('Сеть')} value={wallet?.account.chain==='-239'?'TON Mainnet':wallet?t('Неверная сеть'):'TON Mainnet'}/><ListRow icon="shield" title="TON Proof" value={<StatusPill status={verified?'CONFIRMED':'PENDING'} label={t(verified?'Подтверждён':'Не подтверждён')}/>}/>{verified&&state?.walletVersion&&<ListRow icon="info" title={t('Версия кошелька')} value={state.walletVersion}/>}</div><div className="account-actions">{wallet&&<button className="secondary" onClick={()=>void navigator.clipboard.writeText(wallet.account.address).then(()=>{setError('');setCopied(true)}).catch(()=>setError(t('Не удалось скопировать адрес.')))}><Icon name="copy" size={18}/>{t(copied?'Адрес скопирован':'Копировать адрес')}</button>}{!wallet||!verified?<button className="secondary" disabled={busy||!restored} onClick={()=>void connect()}>{t(wallet?'Подтвердить кошелёк':'Подключить TON-кошелёк')}</button>:<button className="ghost" onClick={()=>void ui.disconnect().catch(e=>setError((e as Error).message))}>{t('Отключить кошелёк')}</button>}</div><div className="ui-list-group wallet-locks"><ListRow icon="lock" title={t('Заблокировано в Base Epoch')} value={<Money value={account?.lockedBase||'0'}/>}/><ListRow icon="bolt" title={t('Капитализировано внутри активного Epoch')} value={<Money value={account?.lockedCompound||'0'}/>}/></div></div></div>
  {!account?<button className="primary" onClick={onLogin}>{t('Войти через Telegram')}</button>:step==='AMOUNT'?
   <div className="panel wallet-payment"><button className="text-button" onClick={()=>setStep('LIST')}>← {t('Назад')}</button><h2>{t('Пополнить USDT')}</h2>{!verified&&<div className="wallet-guard panel"><Icon name="shield"/><div><p>{t(wallet?.account.chain&&wallet.account.chain!=='-239'?'Неверная сеть. Используйте TON Mainnet.':wallet?'Подтвердите владение адресом для пополнения.':'Подключите кошелёк в сети TON, чтобы продолжить.')}</p><button className="secondary" disabled={busy||!restored} onClick={()=>void connect()}>{t(wallet?'Подтвердить кошелёк':'Подключить TON-кошелёк')}</button></div></div>}
    <dl><div><dt>{t('Актив')}</dt><dd>USDT</dd></div><div><dt>{t('Сеть')}</dt><dd>TON Mainnet</dd></div><div><dt>{t('Получатель')}</dt><dd>AetherMind Treasury</dd></div></dl>
    <label>{t('Сумма, USDT')}<input autoFocus aria-describedby="funding-help" inputMode="decimal" autoComplete="off" value={value} onChange={e=>setValue(e.target.value)} placeholder="50.00"/></label>
    <p className="fine" id="funding-help">{t(capabilities.gaslessCandidate&&!signUnsupported?'Комиссия оплачивается в USDT. GRAM не требуется. Точную сумму вы увидите до подписи.':'Для обычного перевода необходим небольшой баланс GRAM. Фактическую комиссию покажет кошелёк.')}</p>
    <button className="primary" disabled={!verified||!state?.depositsEnabled||busy} onClick={()=>void pay()}>{busy?t('Отправка…'):t('Продолжить в кошельке')}</button>
   </div>:step==='GASLESS_REVIEW'&&selected&&quote?<div className="panel wallet-payment"><button className="text-button" onClick={()=>setStep('LIST')}>← {t('Назад')}</button><h2>{t('Проверка пополнения')}</h2>
    <dl><div><dt>{t('Пополнение')}</dt><dd>{amount6(quote.amountUsdt,locale)} USDT</dd></div><div><dt>{t('Сетевая комиссия в USDT')}</dt><dd>{amount6(quote.feeUsdt,locale)} USDT</dd></div><div><dt>{t('На баланс AetherMind')}</dt><dd>{amount6(quote.amountUsdt,locale)} USDT</dd></div><div><dt>{t('Всего необходимо в кошельке')}</dt><dd>{amount6(quote.totalUsdt,locale)} USDT</dd></div><div><dt>GRAM</dt><dd>{t('Не требуется')}</dd></div><div><dt>{t('Оценка действительна до')}</dt><dd>{new Date(quote.expiresAt*1000).toLocaleString(locale)}</dd></div></dl>
    <p className="fine">{t('Кошелёк подпишет перевод, relayer отправит его в TON. Зачисление произойдёт после проверки блокчейна.')}</p>
    <button className="primary" disabled={busy} onClick={()=>void gaslessPay()}>{busy?t('Отправка…'):t('Подписать перевод в кошельке')}</button>
    <button className="secondary" disabled={busy} onClick={()=>{setManualStandard(true);setStep('WAITING')}}>{t('Оплатить обычным способом через GRAM')}</button>
   </div>:step==='WAITING'&&selected?<div className="panel wallet-payment"><h2>{t(selected.status==='CREDITED'?'Платёж зачислен':selected.status==='CANCELLED'?'Счёт отменён':selected.status==='MANUAL_REVIEW'?'Ручная проверка':'Ожидаем подтверждение сети')}</h2><strong>{amount(selected.amount,locale)} USDT</strong><p>{t(labels[selected.status]||selected.status)}</p><p>{t('Подписание в кошельке не означает зачисление. Статус проверяется по блокчейну.')}</p>
    {selected.status==='PENDING'&&manualStandard&&!signedBoc.current&&!selected.gaslessSigned&&standard&&<><button className="secondary" disabled={busy} onClick={()=>void standardPay()}>{t('Оплатить обычным способом через GRAM')}</button>{quote&&!signUnsupported&&<button className="text-button" disabled={busy} onClick={()=>setStep('GASLESS_REVIEW')}>{t('Повторить газлесс-подпись')}</button>}</>}
    {selected.status==='PENDING'&&(signedBoc.current||selected.gaslessSigned)&&<><p className="fine">{t('После подписи не отправляйте платёж повторно обычным способом. Ожидайте зачисления или напишите в поддержку.')}</p>{signedBoc.current&&quote&&<button className="secondary" disabled={busy} onClick={()=>void retryGasless()}>{t('Повторить отправку подписи')}</button>}</>}
    {selected.status==='PENDING'&&!signedBoc.current&&!selected.gaslessSigned&&<><p className="fine">{t('Если перевод уже отправлен, отмена счёта не остановит платёж: поступление проверит сервис.')}</p><button className="secondary" disabled={busy} onClick={()=>void cancel()}>{t('Отменить счёт')}</button></>}
    <button className="secondary" onClick={()=>{setStep('LIST');void refresh()}}>{t('К финансам')}</button>
   </div>:<p className="wallet-availability">{state?.depositsEnabled?t('Пополнение доступно через TON Connect.'):t('Пополнение временно недоступно. Обратитесь в поддержку.')}</p>}
  {(account?.user.isOwner||state?.paymentCanary)&&wallet&&<details className="panel wallet-diagnostics"><summary>TON Connect · diagnostics</summary><pre>{JSON.stringify({appName:wallet.device.appName,appVersion:wallet.device.appVersion,chain:wallet.account.chain,features:wallet.device.features,walletVersion:state?.walletVersion,gaslessAvailable:state?.gaslessAvailable,supportsSignMessage:capabilities.supportsSignMessage,supportsStructuredJetton:capabilities.supportsStructuredJetton,selectedPaymentMode:quote&&!signUnsupported?'GASLESS':'STANDARD'},null,2)}</pre></details>}
  {selected&&<article className="panel wallet-details"><h3>{t('Детали платежа')}</h3><dl><div><dt>Invoice ID</dt><dd>{selected.invoiceId}</dd></div><div><dt>{t('Сумма')}</dt><dd>{amount(selected.amount,locale)} USDT</dd></div><div><dt>{t('Статус')}</dt><dd>{t(labels[selected.status]||selected.status)}</dd></div><div><dt>{t('Сеть')}</dt><dd>TON</dd></div><div><dt>{t('Кошелёк')}</dt><dd>{short(selected.sender)}</dd></div><div><dt>{t('Создан')}</dt><dd>{new Date(selected.createdAt).toLocaleString(locale)}</dd></div><div><dt>{t('Подтверждён')}</dt><dd>{selected.confirmedAt?new Date(selected.confirmedAt).toLocaleString(locale):'—'}</dd></div>{selected.txHash&&<div><dt>Transaction hash</dt><dd><a href={'https://tonviewer.com/transaction/'+selected.txHash} target="_blank" rel="noopener noreferrer">{short(selected.txHash)} ↗</a></dd></div>}</dl>{selected.status==='PENDING'&&!selected.gaslessSigned&&!signedBoc.current&&<button className="secondary" disabled={busy} onClick={()=>void cancel()}>{t('Отменить счёт')}</button>}<button className="secondary" onClick={()=>onSupport({referenceType:'DEPOSIT',referenceId:selected.id,invoiceId:selected.invoiceId})}>{t('Сообщить о проблеме')}</button></article>}
 </section>;
}
