import 'reflect-metadata';
import {Body, Controller, Get, Post, Patch, Param, Headers, Module, UnauthorizedException, ForbiddenException, BadRequestException, ServiceUnavailableException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {FastifyAdapter,NestFastifyApplication} from '@nestjs/platform-fastify';
import {createDb} from './db-utc.js';
import {telegramIdentity,signSession,sessionIdentity,microsToDecimal,validWebhook} from './security.js';
import {catalog} from './catalog.js';
import {Query as QueryParam, NotFoundException} from '@nestjs/common';
import {catalogueQuery,catalogueAvailability,present,MARKET_VERSION,PURCHASES_ENABLED,scaled,type CatalogRow} from './market.js';
import {Req} from '@nestjs/common';
import type {FastifyRequest} from 'fastify';
import {createHmac} from 'node:crypto';
import {createBrowserLogin,bindBrowserLogin,decideBrowserLogin,pollBrowserLogin,loginCode} from './browser-auth.js';
import {journey,OFFER_DOCUMENT_SHA256,OFFER_NUMBER,OFFER_PUBLISHED_AT,OFFER_SIGNED_AT,OFFER_VERSION,offerDocumentMatches,offerTariffs} from './offer.js';
import {nextAccountAction} from './account-state.js';
import {DepositsService,config as tonConfig,center as tonCenter} from './deposits/service.js';
import {GaslessDeposits} from './deposits/gasless-service.js';
import {activity,createWithdrawal,notify,presentWithdrawal,requestData,updateWithdrawal} from './production.js';
import {activate,leaseId,presentLease,purchase,quoteUnbond,rejectProvisioning,unbond} from './financial-cycle.js';
import {financialAccess,financialFlag,financialOffer} from './financial-offer.js';
import {treasuryReady} from './deposits/service.js';
const {BOT_TOKEN,SESSION_SECRET,OWNER_TELEGRAM_ID,DATABASE_URL}=process.env;
const AGREEMENT_VERSION='2026-09-14';
const DEPOSIT_KINDS=['DEPOSIT','DEPOSIT_CONFIRMED','CRYPTO_DEPOSIT_CONFIRMED'];
const OPEN_TICKET_STATUSES=['OPEN','IN_PROGRESS','ANSWERED'];
if(!BOT_TOKEN||!SESSION_SECRET||SESSION_SECRET.length<48||!OWNER_TELEGRAM_ID||!DATABASE_URL) throw Error('Missing secure runtime configuration');
const db=createDb(DATABASE_URL,4);
const deposits=new DepositsService(db);
const gasless=new GaslessDeposits(db);
const publicOrdersReady=()=>financialFlag('PURCHASES')&&financialFlag('EPOCH_ACTIVATION')&&financialFlag('ACCRUAL')&&process.env.FINANCIAL_PUBLIC_ACCESS==='true';
type BotLanguage='ru'|'en'|'ro';
function botLanguage(value?:string|null):BotLanguage{return value?.toLowerCase().startsWith('ro')?'ro':value?.toLowerCase().startsWith('en')?'en':'ru';}
const botWords={
 ru:{approve:'Вход подтверждён. Вернитесь в браузер.',reject:'Вход отклонён.',stale:'Запрос уже обработан или истёк.',login:'Вход в AetherMind в браузере',code:'Код запроса:',check:'Сверьте код с открытой вкладкой. Подтверждайте только вход, который вы начали сами. После подтверждения вернитесь в ту же вкладку.',expired:'Запрос входа истёк или уже обработан. Начните вход заново в браузере.',confirm:'Подтвердить вход',deny:'Отклонить',start:'AetherMind — участие в коммерческом DePIN-кластере GPU. Примите оферту, выберите фиксированный тариф и следите за этапами в профиле.',terms:'Действующие категории: Node Alpha — 50 USDT, Cluster Beta — 300 USDT, Enterprise POD — 1 200 USDT. Quantum Array находится в разработке. Пополнение USDT доступно через динамические инвойсы TON; заявки на вывод рассматриваются оператором. Условия в приложении.',support:'Поддержка AetherMind: откройте приложение и нажмите значок наушников. Обращения и ответы сохраняются в вашем профиле.',open:'Открыть AetherMind'},
 en:{approve:'Sign-in confirmed. Return to your browser.',reject:'Sign-in rejected.',stale:'Request already processed or expired.',login:'AetherMind browser sign-in',code:'Request code:',check:'Compare the code with your browser tab. Only confirm sign-ins you started. Then return to the same tab.',expired:'Sign-in request expired or already processed. Start again in your browser.',confirm:'Confirm sign-in',deny:'Reject',start:'AetherMind — join the commercial DePIN GPU cluster. Accept the offer, select a fixed plan and track your progress in your profile.',terms:'Available plans: Node Alpha — 50 USDT, Cluster Beta — 300 USDT, Enterprise POD — 1,200 USDT. Quantum Array is in development. Deposits use dynamic TON USDT invoices; withdrawal requests are reviewed by an operator. See the app for details.',support:'AetherMind support: open the app and tap the support icon. Your messages and replies are saved in your profile.',open:'Open AetherMind'},
 ro:{approve:'Autentificarea a fost confirmată. Revino în browser.',reject:'Autentificarea a fost refuzată.',stale:'Cererea a fost deja procesată sau a expirat.',login:'Autentificare AetherMind în browser',code:'Codul cererii:',check:'Compară codul cu cel din fila de browser. Confirmă doar autentificările inițiate de tine, apoi revino în aceeași filă.',expired:'Cererea de autentificare a expirat sau a fost deja procesată. Începe din nou în browser.',confirm:'Confirmă autentificarea',deny:'Refuză',start:'AetherMind — participă la clusterul GPU DePIN comercial. Acceptă oferta, alege un plan fix și urmărește etapele în profil.',terms:'Planuri disponibile: Node Alpha — 50 USDT, Cluster Beta — 300 USDT, Enterprise POD — 1 200 USDT. Quantum Array este în dezvoltare. Depunerile folosesc facturi dinamice TON USDT; cererile de retragere sunt analizate de operator.',support:'Asistență AetherMind: deschide aplicația și apasă pictograma de asistență. Mesajele și răspunsurile sunt salvate în profilul tău.',open:'Deschide AetherMind'}
} satisfies Record<BotLanguage,Record<string,string>>;
function identity(auth?:string) {try{return sessionIdentity(auth,SESSION_SECRET!);}catch(e){throw new UnauthorizedException((e as Error).message);}}
async function agreed(auth?:string){const id=identity(auth);const user=await db.user.findUnique({where:{id},select:{agreementVersion:true,agreementAcceptedAt:true}});if(user?.agreementVersion!==AGREEMENT_VERSION||!user.agreementAcceptedAt)throw new ForbiddenException({code:'AGREEMENT_REQUIRED',message:'Примите пользовательское соглашение, чтобы продолжить.',version:AGREEMENT_VERSION});return id;}
async function legacyOfferAccepted(auth?:string){const id=await agreed(auth);if(!await db.offerAcceptance.findUnique({where:{userId_version:{userId:id,version:OFFER_VERSION}}}))throw new ForbiddenException({code:'OFFER_REQUIRED',message:'Примите опубликованную публичную оферту.',version:OFFER_VERSION});return id;}
async function owner(auth?:string){const id=await agreed(auth);if(id!==OWNER_TELEGRAM_ID)throw new ForbiddenException();return id;}
function field(body:Record<string,unknown>,key:string,max:number,min=1) {const value=body?.[key];if(typeof value!=='string'||value.trim().length<min||value.length>max)throw new BadRequestException(`Проверьте поле ${key}.`);return value.trim();}
function uuid(value:string) {if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new BadRequestException('Некорректный идентификатор.');return value;}
function presentRequest<T extends {isTestOrder:boolean}>(row:T){return {...row,isTestOrder:undefined};}
async function telegram(method:string,body:unknown){
 try{const r=await fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/'+method,{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json() as {ok:boolean};if(!r.ok||!result.ok)throw Error();}
 catch{throw new ServiceUnavailableException('Telegram временно недоступен. Повторите запрос.');}
}
@Controller('api')
class Api {
   @Get('offer') offer(){return {number:OFFER_NUMBER,version:OFFER_VERSION,publishedAt:OFFER_PUBLISHED_AT,signedAt:OFFER_SIGNED_AT,documentSha256:OFFER_DOCUMENT_SHA256,tariffs:offerTariffs,paymentsEnabled:tonConfig.access==='public',financialOffer:financialOffer(),accrualEnabled:financialFlag('ACCRUAL'),compoundEnabled:financialFlag('COMPOUND'),currency:'USDT'};}
  @Post('auth/browser/start') async browserStart(@Req() req:FastifyRequest){
    const bot=process.env.BOT_USERNAME||'';if(!/^[a-zA-Z0-9_]{5,32}$/.test(bot))throw new ServiceUnavailableException('Бот для входа ещё не настроен.');
    const ipHash=createHmac('sha256',SESSION_SECRET!).update(req.ip).digest('hex');
    try{const c=await db.$transaction(tx=>createBrowserLogin((sql,params=[])=>tx.$queryRawUnsafe(sql,...params),ipHash));return {...c,url:`https://t.me/${bot}?start=login_${c.id}`};}
    catch(e){if((e as Error).message.startsWith('Слишком много'))throw new BadRequestException((e as Error).message);throw e;}
  }
  @Post('auth/browser/poll') async browserPoll(@Body() body:Record<string,unknown>){
    const id=field(body,'id',36),secret=field(body,'secret',64);
    const r=await db.$transaction(tx=>pollBrowserLogin((sql,params=[])=>tx.$queryRawUnsafe(sql,...params),id,secret));
    return r.userId?{status:r.status,token:signSession(r.userId,SESSION_SECRET!),expiresIn:21600}:{status:r.status};
  }
  @Get('v1/market') async market(@QueryParam('category') category?:string,@QueryParam('sort') sort?:string){
    let q;try{q=catalogueQuery(category,sort);}catch(e){throw new BadRequestException((e as Error).message);}
    const rows=await db.$queryRawUnsafe<CatalogRow[]>(q.sql,...q.params);
    return {version:MARKET_VERSION,nodes:rows.map(row=>present(row,publicOrdersReady())),purchasesEnabled:publicOrdersReady(),updatedAt:new Date().toISOString()};
  }
  @Get('v1/market/leases') async leases(@Headers('authorization') auth:string){
    return (await db.userLease.findMany({where:{userId:await agreed(auth)},include:{node:{select:{name:true}}},orderBy:{createdAt:'desc'},take:100})).map(presentLease);
  }
  @Get('v1/market/:id') async marketDetail(@Param('id') id:string){
    const rows=await db.$queryRawUnsafe<CatalogRow[]>('SELECT * FROM gpu_catalog WHERE id=$1 AND is_active=TRUE',id);
    if(!rows.length)throw new NotFoundException('Нода не найдена.');return present(rows[0],publicOrdersReady());
  }
  @Post('v1/market/buy') async buy(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    return purchase(db,await agreed(auth),body);
  }
  @Get('v1/leases/:id/unbond/quote') async unbondQuote(@Headers('authorization') auth:string,@Param('id') id:string){return quoteUnbond(db,await agreed(auth),leaseId(id));}
  @Post('v1/leases/:id/unbond') async earlyUnbond(@Headers('authorization') auth:string,@Param('id') id:string,@Body() body:Record<string,unknown>){return unbond(db,await agreed(auth),leaseId(id),body);}
  @Get('v1/admin/leases') async adminLeases(@Headers('authorization') auth:string,@QueryParam('page') page?:string){await owner(auth);const n=this.pageNumber(page);const rows=await db.userLease.findMany({include:{user:{select:{id:true,name:true,username:true}},node:{select:{name:true}},requests:{select:{paymentStatus:true,decision:true,closureReason:true}}},orderBy:{createdAt:'desc'},skip:n*30,take:30});return {items:rows.map(row=>({...presentLease(row),user:row.user,request:row.requests[0]||null})),page:n};}
  @Post('v1/admin/leases/:id/activate') async activateLease(@Headers('authorization') auth:string,@Param('id') id:string){return activate(db,await owner(auth),leaseId(id));}
  @Post('v1/admin/leases/:id/reject') async rejectLease(@Headers('authorization') auth:string,@Param('id') id:string,@Body() body:Record<string,unknown>){return rejectProvisioning(db,await owner(auth),leaseId(id),field(body,'reason',1000,3));}
  @Post('telegram/webhook') async webhook(@Headers('x-telegram-bot-api-secret-token') secret:string,@Body() update:any){
    if(!validWebhook(secret,process.env.BOT_WEBHOOK_SECRET))throw new UnauthorizedException();
    if(!Number.isSafeInteger(update?.update_id)||update.update_id<0)throw new BadRequestException();
    const uid=BigInt(update.update_id);if(await db.botUpdate.findUnique({where:{id:uid}}))return {ok:true};
    const callback=update.callback_query;
    if(callback){
      const match=typeof callback.data==='string'?callback.data.match(/^bl:([yn]):([0-9a-f-]{36})$/):null;
      if(!match||typeof callback.id!=='string'||!Number.isSafeInteger(callback.from?.id)||callback.message?.chat?.type!=='private'||callback.message.chat.id!==callback.from.id)return {ok:true};
      const changed=await db.$transaction(tx=>decideBrowserLogin((sql,params=[])=>tx.$queryRawUnsafe(sql,...params),match[2],{id:String(callback.from.id),name:String(callback.from.first_name||'Пользователь'),username:callback.from.username},match[1]==='y'));
      const copy=botWords[botLanguage(callback.from.language_code)];
      await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:changed?(match[1]==='y'?copy.approve:copy.reject):copy.stale,show_alert:true});
      await db.botUpdate.upsert({where:{id:uid},create:{id:uid},update:{}});return {ok:true};
    }
    const msg=update.message;
    if(msg?.chat?.type!=='private'||!Number.isSafeInteger(msg?.from?.id)||msg.from.id!==msg.chat.id||typeof msg.text!=='string')return {ok:true};
    const browser=msg.text.match(/^\/start(?:@[a-zA-Z0-9_]+)?\s+login_([0-9a-f-]{36})$/);
    if(browser){
      const bound=await db.$transaction(tx=>bindBrowserLogin((sql,params=[])=>tx.$queryRawUnsafe(sql,...params),browser[1],String(msg.from.id)));
      const copy=botWords[botLanguage(msg.from.language_code)];
      await telegram('sendMessage',{chat_id:msg.chat.id,text:bound?`${copy.login} ${process.env.PUBLIC_URL}.\n${copy.code} ${loginCode(browser[1])}.\n${copy.check}`:copy.expired,...(bound?{reply_markup:{inline_keyboard:[[{text:copy.confirm,callback_data:`bl:y:${browser[1]}`},{text:copy.deny,callback_data:`bl:n:${browser[1]}`}]]}}:{})});
      await db.botUpdate.upsert({where:{id:uid},create:{id:uid},update:{}});return {ok:true};
    }
    const command=msg.text.split(/[\s@]/)[0];if(!['/start','/support','/terms','/paysupport'].includes(command))return {ok:true};
    const userId=String(msg.from.id),ref=msg.text.match(/^\/start\s+r_([1-9][0-9]{0,15})$/)?.[1];
    if(ref&&ref!==userId&&!await db.user.findUnique({where:{id:userId}})&&await db.user.findUnique({where:{id:ref}}))await db.invite.upsert({where:{telegramId:userId},create:{telegramId:userId,referrerId:ref},update:{}});
    const saved=await db.user.findUnique({where:{id:userId},select:{preferredLanguage:true}});
    const copy=botWords[botLanguage(saved?.preferredLanguage||msg.from.language_code)];
    const text=command==='/start'?copy.start:command==='/terms'?copy.terms:copy.support;
    try{const r=await fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/sendMessage',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:msg.chat.id,text,reply_markup:{inline_keyboard:[[{text:copy.open,web_app:{url:process.env.PUBLIC_URL+'/'}}]]}})});const result=await r.json() as {ok?:boolean};if(!result.ok)throw Error();}catch{throw new ServiceUnavailableException('Bot delivery unavailable');}
    await db.botUpdate.upsert({where:{id:uid},create:{id:uid},update:{}});return {ok:true};
  }
  @Get('health') async health(){await db.$queryRaw`SELECT 1`;return {status:'ok',app:'aethermind',commit:process.env.APP_COMMIT||'local'};}
  @Get('catalog') list(){return {nodes:catalog,load:null,providerConnected:false,paymentsEnabled:tonConfig.access==='public',botUsername:process.env.BOT_USERNAME||'',stage:'REQUESTS'};}
  @Post('auth/telegram') async login(@Body() body:Record<string,unknown>){
    let tg;try{tg=telegramIdentity(field(body,'initData',8192),BOT_TOKEN!);}catch(e){throw new UnauthorizedException((e as Error).message);}
    const pending=await db.invite.findUnique({where:{telegramId:tg.id}});
    const refId=tg.referrer||pending?.referrerId;
    const ref=refId&&refId!==tg.id ? await db.user.findUnique({where:{id:refId}}):null;
    const user=await db.user.upsert({where:{id:tg.id},create:{id:tg.id,name:tg.name,username:tg.username,referrerId:ref?.id},update:{name:tg.name,username:tg.username}});
    return {token:signSession(user.id,SESSION_SECRET!),expiresIn:21600};
  }
  @Patch('me/language') async language(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const id=identity(auth),language=body?.language;
    if(language!=='ru'&&language!=='en'&&language!=='ro')throw new BadRequestException('Unsupported language.');
    await db.$transaction(async tx=>{const previous=await tx.user.findUnique({where:{id},select:{preferredLanguage:true}});if(previous?.preferredLanguage===language)return;await tx.user.update({where:{id},data:{preferredLanguage:language}});await tx.audit.create({data:{actorId:id,action:'LANGUAGE_CHANGED',targetId:language}})});
    return {language};
  }
  @Get('me') async me(@Headers('authorization') auth:string){
    const id=identity(auth);const user=await db.user.findUnique({where:{id},include:{selectedTariff:true,offerAcceptances:{where:{version:OFFER_VERSION},take:1}}});if(!user)throw new UnauthorizedException();
    const [requests,entries,total,refs,tickets,leases,unreadSupport,unreadNotifications]=await Promise.all([
      db.rentalRequest.findMany({where:{userId:id,isTestOrder:false},orderBy:{createdAt:'desc'},take:50}),
      db.ledgerEntry.findMany({where:{userId:id},orderBy:{createdAt:'desc'},take:50}),
      db.ledgerEntry.aggregate({where:{userId:id},_sum:{amountMicros:true}}),
      db.user.findMany({where:{referrerId:id},orderBy:{createdAt:'desc'},take:100,select:{id:true,createdAt:true,selectedTariffId:true,offerAcceptances:{where:{version:OFFER_VERSION},select:{id:true},take:1},leases:{where:{status:{in:['PROVISIONING','ACTIVE','OVERCLOCKED']}},select:{id:true},take:1}}}),
      db.ticket.findMany({where:{userId:id},orderBy:[{lastMessageAt:'desc'},{id:'desc'}],take:30,select:{id:true,category:true,subject:true,status:true,userUnread:true,lastMessageAt:true,createdAt:true,updatedAt:true,_count:{select:{messages:true}},messages:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{id:true,authorType:true,body:true,createdAt:true}}}}),
      db.userLease.findMany({where:{userId:id},orderBy:{createdAt:'desc'},take:30,include:{node:{select:{name:true}}}}),
      db.ticket.count({where:{userId:id,userUnread:true}}),
      db.notification.count({where:{userId:id,isRead:false}})
    ]);
    const accepted=user.agreementVersion===AGREEMENT_VERSION&&Boolean(user.agreementAcceptedAt),offerAcceptance=user.offerAcceptances[0]||null;
    const balanceMicros=total._sum.amountMicros||0n,selected=offerTariffs.find(t=>t.nodeId===user.selectedTariffId)||null;
    const ordered=leases.some(l=>l.nodeId===selected?.nodeId&&['PROVISIONING','ACTIVE','OVERCLOCKED','EXPIRED'].includes(l.status));
    const pendingOrder=requests.some(r=>!r.isTestOrder&&r.nodeId===selected?.nodeId&&['REQUESTED','REVIEWED'].includes(r.status));
    const funded=Boolean(selected)&&balanceMicros>=BigInt(selected!.depositUsdt)*1000000n;
    const epochComplete=leases.some(l=>['EXPIRED','COMPLETED','EARLY_UNBONDED'].includes(l.status));
    const newOffer=financialOffer();
    const selectedCatalog=user.selectedTariffId?await db.gpuCatalog.findUnique({where:{id:user.selectedTariffId}}):null;
    const selectedAvailability=selectedCatalog?catalogueAvailability({id:selectedCatalog.id,name:selectedCatalog.name,category:selectedCatalog.category,tier_level:selectedCatalog.tierLevel,chip:selectedCatalog.chip,precision_label:selectedCatalog.precisionLabel,workload:selectedCatalog.workload,price_usdt:selectedCatalog.priceUsdt.toString(),daily_yield_percent:selectedCatalog.dailyYieldPercent.toString(),compound_boost_percent:selectedCatalog.compoundBoostPercent?.toString()??null,tflops_power:selectedCatalog.tflopsPower,total_supply:selectedCatalog.totalSupply,available_supply:selectedCatalog.availableSupply,supply_known:selectedCatalog.supplyKnown,contract_days:selectedCatalog.contractDays,max_per_user:selectedCatalog.maxPerUser,image_url:selectedCatalog.imageUrl,is_active:selectedCatalog.isActive,is_experimental:selectedCatalog.isExperimental,contract_reference:selectedCatalog.contractReference},publicOrdersReady()):null;
    const newAcceptance=newOffer?await db.offerAcceptance.findUnique({where:{userId_version:{userId:id,version:newOffer.version}}}):null;
    const lockedBase=leases.filter(l=>l.status==='ACTIVE'&&l.mode==='BASE').reduce((sum,l)=>sum+(l.principalMicros||0n),0n);
    const lockedCompound=leases.filter(l=>l.status==='ACTIVE'&&l.mode==='COMPOUND').reduce((sum,l)=>sum+(l.compoundPrincipalMicros||l.principalMicros||0n),0n);
    const referralItems=refs.map(r=>{const active=Boolean(r.leases.length),selectedTariff=Boolean(r.selectedTariffId),offerAccepted=Boolean(r.offerAcceptances.length);return {id:createHmac('sha256',SESSION_SECRET!).update('ref:'+r.id).digest('hex').slice(0,12),label:'Участник '+createHmac('sha256',SESSION_SECRET!).update(r.id).digest('hex').slice(0,4).toUpperCase(),stage:active?'ACTIVE':selectedTariff?'TARIFF_SELECTED':offerAccepted?'OFFER_ACCEPTED':'REGISTERED',joinedAt:r.createdAt};});
     return {user:{id:user.id,name:user.name,username:user.username,createdAt:user.createdAt,isOwner:id===OWNER_TELEGRAM_ID,preferredLanguage:user.preferredLanguage},agreement:{version:AGREEMENT_VERSION,accepted,acceptedAt:accepted?user.agreementAcceptedAt:null},offer:{number:OFFER_NUMBER,version:OFFER_VERSION,documentSha256:OFFER_DOCUMENT_SHA256,accepted:Boolean(offerAcceptance)&&offerAcceptance?.documentSha256===OFFER_DOCUMENT_SHA256,acceptedAt:offerAcceptance?.acceptedAt||null},financialOffer:newOffer?{...newOffer,accepted:newAcceptance?.documentSha256===newOffer.sha256,acceptedAt:newAcceptance?.acceptedAt||null}:null,balance:microsToDecimal(balanceMicros),lockedBase:microsToDecimal(lockedBase),lockedCompound:microsToDecimal(lockedCompound),earnedToday:null,selectedTariff:selected?{...selected,selectedAt:user.selectedTariffAt}:null,nextAction:nextAccountAction({selected,balanceMicros,requests,leases,purchasesEnabled:publicOrdersReady()&&financialAccess(id),stockAvailable:selectedAvailability==='AVAILABLE',currentOfferAccepted:newAcceptance?.documentSha256===newOffer?.sha256}),journey:journey({selected:Boolean(selected),funded,ordered,epochComplete,pendingOrder,purchaseEnabled:publicOrdersReady()&&financialAccess(id)}),requests:requests.map(presentRequest),tickets,notifications:{unreadSupport,unreadOrders:requests.filter(r=>!r.isTestOrder&&r.userUnread).length,unread:unreadNotifications},activeNodes:leases.map(presentLease),referrals:{total:referralItems.length,active:referralItems.filter(r=>r.stage==='ACTIVE').length,items:referralItems,rewardConfigured:false},entries:entries.map(e=>({...e,amountMicros:undefined,amount:microsToDecimal(e.amountMicros)})),paymentsEnabled:tonConfig.access==='public',accrualEnabled:financialFlag('ACCRUAL')&&financialAccess(id),compoundEnabled:financialFlag('COMPOUND')&&financialAccess(id),purchasesEnabled:publicOrdersReady()&&financialAccess(id),updatedAt:new Date().toISOString()};
  }
  @Post('agreement/accept') async acceptAgreement(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const id=identity(auth),version=field(body,'version',32);if(version!==AGREEMENT_VERSION)throw new BadRequestException('Версия соглашения устарела. Обновите приложение.');
    return db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 23))`;const current=await tx.user.findUnique({where:{id},select:{agreementVersion:true,agreementAcceptedAt:true}});if(!current)throw new UnauthorizedException();if(current.agreementVersion===version&&current.agreementAcceptedAt)return {version,accepted:true,acceptedAt:current.agreementAcceptedAt};const acceptedAt=new Date();await tx.user.update({where:{id},data:{agreementVersion:version,agreementAcceptedAt:acceptedAt}});await tx.audit.create({data:{actorId:id,action:'AGREEMENT_ACCEPTED',targetId:version}});return {version,accepted:true,acceptedAt};});
  }
   @Post('offer/accept') async acceptOffer(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>,@Req() req:FastifyRequest){
     const userId=await agreed(auth),version=field(body,'version',64),documentSha256=field(body,'documentSha256',64);
     if(!offerDocumentMatches())throw new ServiceUnavailableException({code:'OFFER_DOCUMENT_UNAVAILABLE',message:'Документ оферты недоступен или его контрольная сумма не совпадает.'});
    if(version!==OFFER_VERSION||documentSha256!==OFFER_DOCUMENT_SHA256||body.readConfirmed!==true)throw new BadRequestException('Оферта изменилась или не прочитана полностью. Обновите приложение.');
    const clientHash=createHmac('sha256',SESSION_SECRET!).update(`${req.ip}\n${String(req.headers['user-agent']||'')}`).digest('hex');
    return db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 88))`;const current=await tx.offerAcceptance.findUnique({where:{userId_version:{userId,version}}});if(current)return {version,accepted:true,acceptedAt:current.acceptedAt};const row=await tx.offerAcceptance.create({data:{userId,version,documentSha256,clientHash}});await tx.audit.create({data:{actorId:userId,action:'PUBLIC_OFFER_ACCEPTED',targetId:version}});return {version,accepted:true,acceptedAt:row.acceptedAt};});
  }
  @Get('v1/financial-offer') async currentFinancialOffer(@Headers('authorization') auth:string){
    const userId=await agreed(auth),offer=financialOffer();
    if(!offer)return {available:false};
    const acceptance=await db.offerAcceptance.findUnique({where:{userId_version:{userId,version:offer.version}}});
    return {available:true,...offer,accepted:acceptance?.documentSha256===offer.sha256,acceptedAt:acceptance?.acceptedAt||null};
  }
  @Post('v1/financial-offer/accept') async acceptFinancialOffer(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>,@Req() req:FastifyRequest){
    const userId=await agreed(auth),offer=financialOffer();
    if(!offer)throw new ServiceUnavailableException({code:'CURRENT_OFFER_REQUIRED',message:'Новая редакция ожидает публикации.'});
    if(body.version!==offer.version||body.documentSha256!==offer.sha256||body.readConfirmed!==true)throw new BadRequestException('Оферта изменилась или не прочитана полностью. Обновите приложение.');
    const clientHash=createHmac('sha256',SESSION_SECRET!).update(`${req.ip}\n${String(req.headers['user-agent']||'')}`).digest('hex');
    return db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      const prior=await tx.offerAcceptance.findUnique({where:{userId_version:{userId,version:offer.version}}});
      if(prior){if(prior.documentSha256!==offer.sha256)throw new BadRequestException('Редакция документа изменилась.');return {accepted:true,version:offer.version,acceptedAt:prior.acceptedAt};}
      const row=await tx.offerAcceptance.create({data:{userId,version:offer.version,documentSha256:offer.sha256,clientHash}});
      await tx.audit.create({data:{actorId:userId,action:'FINANCIAL_OFFER_ACCEPTED',targetId:offer.version}});
      return {accepted:true,version:offer.version,acceptedAt:row.acceptedAt};});
  }
  @Post('profile/tariff') async selectTariff(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const userId=await legacyOfferAccepted(auth),nodeId=field(body,'nodeId',64),known=offerTariffs.find(t=>t.nodeId===nodeId);
    if(!known||!known.available)throw new BadRequestException('Этот тариф пока недоступен для выбора.');
    return db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 89))`;if(await tx.userLease.count({where:{userId,status:{in:['PROVISIONING','ACTIVE','OVERCLOCKED']}}})||await tx.rentalRequest.count({where:{userId,isTestOrder:false,status:{in:['REQUESTED','REVIEWED']}}}))throw new BadRequestException('Дождитесь решения по текущему заказу.');const current=await tx.user.findUnique({where:{id:userId},select:{selectedTariffId:true,selectedTariffAt:true}});if(!current)throw new UnauthorizedException();if(current.selectedTariffId===nodeId)return {selected:true,tariff:known,selectedAt:current.selectedTariffAt};const selectedAt=new Date();await tx.user.update({where:{id:userId},data:{selectedTariffId:nodeId,selectedTariffAt:selectedAt}});await tx.audit.create({data:{actorId:userId,action:'TARIFF_SELECTED',targetId:nodeId}});return {selected:true,tariff:known,selectedAt};});
  }
  @Post('requests') async request(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const id=await legacyOfferAccepted(auth), nodeId=field(body,'nodeId',64),profile='MANAGED',workload='Распределение мощностей и задач выполняет сервис AetherMind.',key=uuid(field(body,'idempotencyKey',36));
    const marketNode=await db.gpuCatalog.findUnique({where:{id:nodeId}});
    const eligible=marketNode?marketNode.isActive&&!marketNode.isExperimental&&(!marketNode.supplyKnown||marketNode.availableSupply>0):catalog.some(n=>n.id===nodeId&&n.status==='ON_REQUEST');
    if(!eligible)throw new BadRequestException('Нода недоступна.');
    const prior=await db.rentalRequest.findUnique({where:{userId_idempotencyKey:{userId:id,idempotencyKey:key}}});if(prior)return presentRequest(prior);
    // One open request per user: transaction-level advisory lock prevents concurrent duplicates.
    return db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
      const same=await tx.rentalRequest.findUnique({where:{userId_idempotencyKey:{userId:id,idempotencyKey:key}}});if(same)return presentRequest(same);
      if(await tx.rentalRequest.count({where:{userId:id,status:{in:['REQUESTED','REVIEWED']}}}))throw new BadRequestException('У вас уже есть открытая заявка. Напишите в поддержку.');
      const result=await tx.rentalRequest.create({data:{userId:id,nodeId,profile,workload,idempotencyKey:key}});
      await tx.audit.create({data:{actorId:id,action:'REQUEST_CREATED',targetId:result.id}});return presentRequest(result);
    });
  }
  @Post('support') async support(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const userId=await agreed(auth),message=field(body,'message',2000,5);
    const category=body.category===undefined?'QUESTION':field(body,'category',16),subject=body.subject===undefined?'Обращение':field(body,'subject',120,3);
    if(!['QUESTION','PAYMENT','WITHDRAWAL','ACCOUNT','WALLET','NODE','TECHNICAL','OTHER','COMPLAINT'].includes(category))throw new BadRequestException('Выберите тип обращения.');
    const referenceType=body.referenceType===undefined?null:field(body,'referenceType',24);
    const referenceId=referenceType?uuid(field(body,'referenceId',36)):null;
    if(referenceType&&!['DEPOSIT','WITHDRAWAL'].includes(referenceType)||!referenceType&&body.referenceId!==undefined)throw new BadRequestException('Некорректная ссылка на операцию.');
    if(referenceType==='DEPOSIT'&&!await db.tonDeposit.findFirst({where:{id:referenceId!,userId},select:{id:true}}))throw new NotFoundException('Пополнение не найдено.');
    if(referenceType==='WITHDRAWAL'&&!await db.withdrawalRequest.findFirst({where:{id:referenceId!,userId},select:{id:true}}))throw new NotFoundException('Заявка не найдена.');
    return db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 31))`;
      if(await tx.ticket.count({where:{userId,createdAt:{gt:new Date(Date.now()-3600000)}}})>=5)throw new BadRequestException('Не более 5 обращений в час.');
      const now=new Date();
      const result=await tx.ticket.create({data:{userId,message,category,subject,referenceType,referenceId,lastMessageAt:now,ownerUnread:true,userUnread:false,messages:{create:{authorType:'USER',authorId:userId,body:message,createdAt:now}}}});
      await tx.audit.create({data:{actorId:userId,action:'SUPPORT_CREATED',targetId:result.id}});return result;
    });
  }
  @Get('support/:id') async supportTicket(@Headers('authorization') auth:string,@Param('id') target:string){
    const userId=await agreed(auth),id=uuid(target);
    const ticket=await db.ticket.findFirst({where:{id,userId},include:{messages:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:200}}});
    if(!ticket)throw new NotFoundException('Обращение не найдено.');
    ticket.messages.reverse();return ticket;
  }
  @Post('support/:id/messages') async supportMessage(@Headers('authorization') auth:string,@Param('id') target:string,@Body() body:Record<string,unknown>){
    const userId=await agreed(auth),id=uuid(target),message=field(body,'message',2000,2);
    return db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 34))`;
      const current=await tx.ticket.findFirst({where:{id,userId}});if(!current)throw new NotFoundException('Обращение не найдено.');
      if(current.status==='CLOSED')throw new BadRequestException('Тикет закрыт оператором. Создайте новое обращение.');
      if(await tx.ticketMessage.count({where:{ticketId:id,authorType:'USER',createdAt:{gt:new Date(Date.now()-3600000)}}})>=20)throw new BadRequestException('Слишком много сообщений. Повторите позже.');
      const now=new Date();
      await tx.ticketMessage.create({data:{ticketId:id,authorType:'USER',authorId:userId,body:message,createdAt:now}});
      const result=await tx.ticket.update({where:{id},data:{status:'OPEN',ownerUnread:true,userUnread:false,lastMessageAt:now}});
      await tx.audit.create({data:{actorId:userId,action:'SUPPORT_FOLLOW_UP',targetId:id}});return result;
    });
  }
  @Post('support/:id/read') async readSupport(@Headers('authorization') auth:string,@Param('id') target:string){
    const userId=await agreed(auth),id=uuid(target),result=await db.ticket.updateMany({where:{id,userId},data:{userUnread:false}});
    if(!result.count)throw new NotFoundException('Обращение не найдено.');return {read:true};
  }
   @Post('payments') async payment(@Headers('authorization') auth:string){await agreed(auth);throw new BadRequestException('Создайте динамический счёт USDT TON через /api/v1/deposits.');}
  @Post('withdrawals') async withdrawal(@Headers('authorization') auth:string){await agreed(auth);throw new ServiceUnavailableException('Автоматический вывод отключён. Создайте заявку в разделе «Финансы».');}
  @Get('v1/notifications') async notifications(@Headers('authorization') auth:string){const userId=await agreed(auth);const [items,unread]=await Promise.all([db.notification.findMany({where:{userId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100,select:{id:true,type:true,title:true,message:true,referenceType:true,referenceId:true,isRead:true,createdAt:true}}),db.notification.count({where:{userId,isRead:false}})]);return {items,unread};}
  @Post('v1/notifications/read-all') async readNotifications(@Headers('authorization') auth:string){const userId=await agreed(auth);await db.notification.updateMany({where:{userId,isRead:false},data:{isRead:true}});return {read:true};}
  @Post('v1/notifications/:id/read') async readNotification(@Headers('authorization') auth:string,@Param('id') target:string){const userId=await agreed(auth),id=uuid(target);const result=await db.notification.updateMany({where:{id,userId},data:{isRead:true}});if(!result.count)throw new NotFoundException('Уведомление не найдено.');return {read:true};}
  @Post('v1/withdrawals') async createWithdrawal(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){return createWithdrawal(db,await agreed(auth),body);}
  @Get('v1/withdrawals') async withdrawals(@Headers('authorization') auth:string){const userId=await agreed(auth);return {items:(await db.withdrawalRequest.findMany({where:{userId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50})).map(presentWithdrawal)};}
  @Get('v1/withdrawals/:id') async withdrawalDetail(@Headers('authorization') auth:string,@Param('id') target:string){const userId=await agreed(auth);const row=await db.withdrawalRequest.findFirst({where:{id:uuid(target),userId}});if(!row)throw new NotFoundException('Заявка не найдена.');return presentWithdrawal(row);}
  @Post('v1/withdrawals/:id/cancel') async cancelWithdrawal(@Headers('authorization') auth:string,@Param('id') target:string){return updateWithdrawal(db,await agreed(auth),uuid(target),{status:'CANCELLED'},false);}
  @Get('v1/admin/withdrawals') async ownerWithdrawals(@Headers('authorization') auth:string,@QueryParam('page') page?:string){await owner(auth);const n=this.pageNumber(page),where={};const [rows,total]=await Promise.all([db.withdrawalRequest.findMany({where,include:{user:{select:{id:true,name:true,username:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:n*30,take:30}),db.withdrawalRequest.count({where})]);return {items:rows.map(row=>({...presentWithdrawal(row),user:row.user})),page:n,total,hasMore:(n+1)*30<total};}
  @Get('v1/admin/withdrawals/:id') async ownerWithdrawal(@Headers('authorization') auth:string,@Param('id') target:string){await owner(auth);const row=await db.withdrawalRequest.findUnique({where:{id:uuid(target)},include:{user:{select:{id:true,name:true,username:true}}}});if(!row)throw new NotFoundException();return {...presentWithdrawal(row),user:row.user};}
  @Patch('v1/admin/withdrawals/:id') async reviewWithdrawal(@Headers('authorization') auth:string,@Param('id') target:string,@Body() body:Record<string,unknown>){return updateWithdrawal(db,await owner(auth),uuid(target),body,true);}
  @Get('v1/activity') async unifiedActivity(@Headers('authorization') auth:string,@QueryParam('type') type?:string){return activity(db,await agreed(auth),type||'ALL');}
  @Get('v1/status') async status(@Headers('authorization') auth:string){await agreed(auth);const cursor=await db.tonWatcherCursor.findUnique({where:{id:'TON_USDT'}});const fresh=Boolean(cursor&&Date.now()-cursor.updatedAt.getTime()<180000);const ready=tonConfig.enabled&&Boolean(tonConfig.apiKey)&&await treasuryReady();const rows=await db.$queryRawUnsafe<CatalogRow[]>('SELECT * FROM gpu_catalog WHERE is_active = TRUE');const orderReady=rows.some(row=>catalogueAvailability(row,publicOrdersReady())==='AVAILABLE');return {platform:'OPERATIONAL',tonDeposits:!tonConfig.enabled?'PAUSED':!ready||!fresh?'DEGRADED':tonConfig.access==='canary'?'LIMITED':'OPERATIONAL',withdrawals:'OPERATIONAL',orders:orderReady?'OPERATIONAL':financialFlag('PURCHASES')?'DEGRADED':'PAUSED',accrual:financialFlag('ACCRUAL')?'OPERATIONAL':'PAUSED',build:process.env.APP_COMMIT||'local',network:'TON Mainnet'};}
  @Get('v1/admin/operations') async operations(@Headers('authorization') auth:string){await owner(auth);const cursor=await db.tonWatcherCursor.findUnique({where:{id:'TON_USDT'}});const lastEpochAccrual=await db.leaseAccrual.findFirst({orderBy:{createdAt:'desc'},select:{createdAt:true}});const checks=await Promise.allSettled([tonConfig.apiKey?tonCenter.jettonWallet(tonConfig.treasury):Promise.reject(),gasless.provider.enabled?gasless.provider.relay():Promise.reject(),process.env.BOT_TOKEN?fetch('https://api.telegram.org/bot'+process.env.BOT_TOKEN+'/getWebhookInfo',{signal:AbortSignal.timeout(2500)}).then(r=>r.ok):Promise.reject()]);return {backend:'OPERATIONAL',database:'OPERATIONAL',tonCenter:checks[0].status==='fulfilled'?'OPERATIONAL':'UNAVAILABLE',tonApi:checks[1].status==='fulfilled'&&Boolean(checks[1].value)?'OPERATIONAL':'UNAVAILABLE',telegram:checks[2].status==='fulfilled'&&checks[2].value?'OPERATIONAL':'UNAVAILABLE',depositWatcher:cursor&&Date.now()-cursor.updatedAt.getTime()<180000?'OPERATIONAL':'DEGRADED',lastReconciliation:cursor?.updatedAt||null,gasless:gasless.provider.enabled?(tonConfig.gaslessSmokeOwnerOnly?'CANARY':'PUBLIC'):'DISABLED',depositMode:tonConfig.access,withdrawalMode:'MANUAL',orders:financialFlag('PURCHASES')?(process.env.FINANCIAL_PUBLIC_ACCESS==='true'?'PUBLIC':'CANARY'):'PAUSED',accrual:financialFlag('ACCRUAL')?'ENABLED':'DISABLED',financialOfferReady:Boolean(financialOffer()),financialFlags:{purchases:financialFlag('PURCHASES'),activation:financialFlag('EPOCH_ACTIVATION'),accrual:financialFlag('ACCRUAL'),compound:financialFlag('COMPOUND'),earlyUnbonding:financialFlag('EARLY_UNBONDING'),publicAccess:process.env.FINANCIAL_PUBLIC_ACCESS==='true'},lastEpochAccrual:lastEpochAccrual?.createdAt||null,build:process.env.APP_COMMIT||'local',uptimeSeconds:Math.floor(process.uptime())};}
  @Post('v1/data-requests') async createDataRequest(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){return requestData(db,await agreed(auth),body.kind);}
  @Get('v1/data-requests') async dataRequests(@Headers('authorization') auth:string){const userId=await agreed(auth);return {items:await db.dataRequest.findMany({where:{userId},orderBy:{createdAt:'desc'},take:20})};}
  @Get('v1/admin/data-requests') async ownerDataRequests(@Headers('authorization') auth:string,@QueryParam('page') page?:string){await owner(auth);const n=this.pageNumber(page);return {items:await db.dataRequest.findMany({include:{user:{select:{id:true,name:true,username:true}}},orderBy:{createdAt:'desc'},skip:n*30,take:30}),page:n};}
  @Post('v1/ton/proof/payload') async tonPayload(@Headers('authorization') auth:string){return deposits.challenge(await agreed(auth));}
  @Post('v1/ton/proof/verify') async tonVerify(@Headers('authorization') auth:string,@Body() body:any){return deposits.verify(await agreed(auth),body);}
  @Get('v1/ton/health') async tonHealth(@Headers('authorization') auth:string){
    await owner(auth);
    let treasuryJettonWallet:string|null=null;
    if(tonConfig.apiKey)try{treasuryJettonWallet=(await tonCenter.jettonWallet(tonConfig.treasury)).toRawString();}catch{}
    let treasuryGramNano:string|null=null;
    if(tonConfig.apiKey)try{treasuryGramNano=(await tonCenter.treasuryBalance()).toString();}catch{}
    let indexed=false;
    if(tonConfig.apiKey)try{await tonCenter.transactions(Math.floor(Date.now()/1000)-300,0,1);indexed=true;}catch{}
    let relay:string|null=null;
    if(gasless.provider.enabled)try{relay=(await gasless.provider.relay())?.toRawString()||null;}catch{}
    return {network:'mainnet',depositAccess:tonConfig.access,standardAttachNano:tonConfig.attachAmount.toString(),notificationForwardNano:tonConfig.notificationForwardNano.toString(),tonCenter:{configured:Boolean(tonConfig.apiKey),reachable:Boolean(treasuryJettonWallet),indexed},tonApi:{configured:Boolean(tonConfig.tonApiKey),reachable:Boolean(relay),officialUsdtSupported:Boolean(relay)},gasless:{enabled:gasless.provider.enabled,rollout:tonConfig.gaslessSmokeOwnerOnly?'canary':'public'},treasuryJettonWallet,treasuryGramNano,minTreasuryGramNano:tonConfig.minTreasuryReserve.toString(),treasuryReady:treasuryGramNano!==null&&BigInt(treasuryGramNano)>=tonConfig.minTreasuryReserve,relay};
  }
   @Get('v1/wallet') async tonWallet(@Headers('authorization') auth:string){const userId=await agreed(auth);return {...await deposits.wallet(userId),gaslessAvailable:gasless.provider.enabled};}
  @Get('v1/wallet/transactions') async tonHistory(@Headers('authorization') auth:string){return {items:await deposits.list(await agreed(auth))};}
   @Post('v1/deposits') async createDeposit(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){return deposits.create(await legacyOfferAccepted(auth),body);}
  @Post('v1/deposits/:id/gasless/estimate') async gaslessEstimate(@Headers('authorization') auth:string,@Param('id') id:string){return gasless.estimate(await agreed(auth),uuid(id));}
  @Post('v1/deposits/:id/gasless/send') async gaslessSend(@Headers('authorization') auth:string,@Param('id') id:string,@Body() body:Record<string,unknown>){return gasless.send(await agreed(auth),uuid(id),body);}
  @Get('v1/deposits') async listDeposits(@Headers('authorization') auth:string){return {items:await deposits.list(await agreed(auth))};}
  @Post('v1/deposits/:id/cancel') async cancelDeposit(@Headers('authorization') auth:string,@Param('id') id:string){return deposits.cancel(await agreed(auth),uuid(id));}
  @Get('v1/deposits/:id') async depositById(@Headers('authorization') auth:string,@Param('id') id:string){return deposits.get(await agreed(auth),uuid(id));}
  @Get('v1/admin/deposits') async adminDeposits(@Headers('authorization') auth:string,@QueryParam('page') page?:string,@QueryParam('status') status?:string){
    await owner(auth);
    if(status&&!['PENDING','CANCELLED','DETECTED','CONFIRMED','CREDITED','EXPIRED','FAILED','REJECTED','MANUAL_REVIEW'].includes(status))throw new BadRequestException('Неверный статус.');
    return deposits.admin(this.pageNumber(page),status);
  }
  @Get('v1/admin/deposits/unmatched') async adminUnmatched(@Headers('authorization') auth:string,@QueryParam('page') page?:string){await owner(auth);return deposits.adminUnmatched(this.pageNumber(page));}
  @Get('v1/admin/deposits/:id') async adminDeposit(@Headers('authorization') auth:string,@Param('id') id:string){await owner(auth);return deposits.adminDetail(uuid(id));}
  @Get('admin') async admin(@Headers('authorization') auth:string){
    await owner(auth);
    const [users,requests,pendingPayments,tickets,unreadTickets,deposits]=await Promise.all([
      db.user.count(),
      db.rentalRequest.count({where:{status:{in:['REQUESTED','REVIEWED']}}}),
      db.rentalRequest.count({where:{paymentStatus:'WAITING',status:{in:['REQUESTED','REVIEWED']}}}),
      db.ticket.count({where:{status:{in:OPEN_TICKET_STATUSES}}}),
      db.ticket.count({where:{ownerUnread:true,status:{in:OPEN_TICKET_STATUSES}}}),
      db.ledgerEntry.aggregate({where:{kind:{in:DEPOSIT_KINDS},amountMicros:{gt:0n}},_sum:{amountMicros:true}})
    ]);
    return {users,openRequests:requests,pendingPayments,openTickets:tickets,unreadTickets,confirmedDeposits:microsToDecimal(deposits._sum.amountMicros||0n)};
  }
  @Get('admin/users') async users(@Headers('authorization') auth:string,@QueryParam('page') page?:string,@QueryParam('q') q?:string){
    await owner(auth);const pageNumber=this.pageNumber(page),skip=pageNumber*30,query=(q||'').trim();
    if(query.length>64)throw new BadRequestException('Слишком длинный запрос.');
    const where:any=query?{OR:[{id:{contains:query}},{name:{contains:query,mode:'insensitive'}},{username:{contains:query.replace(/^@/,''),mode:'insensitive'}}]}:{};
    const [rows,total]=await Promise.all([
      db.user.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip,take:30,select:{id:true,name:true,username:true,createdAt:true,selectedTariffId:true,selectedTariff:{select:{name:true}}}}),
      db.user.count({where})
    ]);
    const ids=rows.map(row=>row.id);
    const [referralGroups,balanceGroups,depositGroups]=ids.length?await Promise.all([
      db.user.groupBy({by:['referrerId'],where:{referrerId:{in:ids}},_count:{_all:true}}),
      db.ledgerEntry.groupBy({by:['userId'],where:{userId:{in:ids}},_sum:{amountMicros:true}}),
      db.ledgerEntry.groupBy({by:['userId'],where:{userId:{in:ids},kind:{in:DEPOSIT_KINDS},amountMicros:{gt:0n}},_sum:{amountMicros:true}})
    ]):[[],[],[]];
    const referrals=new Map<string,number>(referralGroups.flatMap(row=>row.referrerId?[[row.referrerId,row._count._all] as [string,number]]:[]));
    const balances=new Map<string,bigint>(balanceGroups.map(row=>[row.userId,row._sum.amountMicros||0n]));
    const deposits=new Map<string,bigint>(depositGroups.map(row=>[row.userId,row._sum.amountMicros||0n]));
    return {items:rows.map(row=>({...row,invitedCount:referrals.get(row.id)||0,balance:microsToDecimal(balances.get(row.id)||0n),deposited:microsToDecimal(deposits.get(row.id)||0n)})),page:pageNumber,total,hasMore:skip+rows.length<total};
  }
  @Get('admin/users/:id') async userDetails(@Headers('authorization') auth:string,@Param('id') target:string,@QueryParam('refPage') refPage?:string){
    await owner(auth);const id=this.telegramId(target),referralPage=this.pageNumber(refPage);
    const user=await db.user.findUnique({where:{id},include:{selectedTariff:{select:{id:true,name:true,priceUsdt:true,contractDays:true}},offerAcceptances:{where:{version:OFFER_VERSION},select:{version:true,acceptedAt:true},take:1}}});
    if(!user)throw new NotFoundException('Пользователь не найден.');
    const [balance,deposits,invited,invitedCount,requests,leases,ticketTotal,ticketOpen]=await Promise.all([
      db.ledgerEntry.aggregate({where:{userId:id},_sum:{amountMicros:true}}),
      db.ledgerEntry.aggregate({where:{userId:id,kind:{in:DEPOSIT_KINDS},amountMicros:{gt:0n}},_sum:{amountMicros:true}}),
      db.user.findMany({where:{referrerId:id},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:referralPage*100,take:100,select:{id:true,name:true,username:true,createdAt:true,selectedTariff:{select:{id:true,name:true}}}}),
      db.user.count({where:{referrerId:id}}),
      db.rentalRequest.findMany({where:{userId:id,isTestOrder:false},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100}),
      db.userLease.findMany({where:{userId:id},orderBy:{createdAt:'desc'},take:100,include:{node:{select:{name:true}}}}),
      db.ticket.count({where:{userId:id}}),
      db.ticket.count({where:{userId:id,status:{in:OPEN_TICKET_STATUSES}}})
    ]);
    const nodes=await this.equipmentNames(requests.map(request=>request.nodeId));
    return {user:{id:user.id,name:user.name,username:user.username,createdAt:user.createdAt,referrerId:user.referrerId},statistics:{invitedCount,deposited:microsToDecimal(deposits._sum.amountMicros||0n),balance:microsToDecimal(balance._sum.amountMicros||0n),tickets:ticketTotal,openTickets:ticketOpen},documents:{agreementAcceptedAt:user.agreementAcceptedAt,offerAcceptedAt:user.offerAcceptances[0]?.acceptedAt||null},selectedTariff:user.selectedTariff,invited,referrals:{page:referralPage,total:invitedCount,hasMore:(referralPage+1)*100<invitedCount},requests:requests.map(request=>(Object.assign({},presentRequest(request),{equipment:{id:request.nodeId,name:nodes.get(request.nodeId)||request.nodeId}}))),leases};
  }
  @Get('admin/requests') async requests(@Headers('authorization') auth:string,@QueryParam('page') page?:string,@QueryParam('status') status?:string,@QueryParam('payment') payment?:string){
    await owner(auth);const pageNumber=this.pageNumber(page),skip=pageNumber*30;
    if(status&&!['REQUESTED','REVIEWED','CLOSED'].includes(status))throw new BadRequestException('Некорректный статус заявки.');
    if(payment&&!['WAITING','PAID'].includes(payment))throw new BadRequestException('Некорректный статус платежа.');
    const where={isTestOrder:false,...(status?{status}:{}),...(payment?{paymentStatus:payment}:{})};
    const [rows,total]=await Promise.all([db.rentalRequest.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip,take:30,include:{user:{select:{id:true,name:true,username:true}}}}),db.rentalRequest.count({where})]);
    const nodes=await this.equipmentNames(rows.map(row=>row.nodeId));
    return {items:rows.map(row=>(Object.assign({},presentRequest(row),{equipment:{id:row.nodeId,name:nodes.get(row.nodeId)||row.nodeId}}))),page:pageNumber,total,hasMore:skip+rows.length<total};
  }
  @Get('admin/tickets') async tickets(@Headers('authorization') auth:string,@QueryParam('page') page?:string,@QueryParam('status') status?:string,@QueryParam('category') category?:string){
    await owner(auth);const pageNumber=this.pageNumber(page),skip=pageNumber*30;
    if(status&&!['OPEN','IN_PROGRESS','ANSWERED','CLOSED'].includes(status))throw new BadRequestException();
    if(category&&!['QUESTION','PAYMENT','WITHDRAWAL','ACCOUNT','WALLET','NODE','TECHNICAL','OTHER','COMPLAINT'].includes(category))throw new BadRequestException();
    const where={...(status?{status}:{}),...(category?{category}:{})};
    const [rows,total]=await Promise.all([
      db.ticket.findMany({where,orderBy:[{lastMessageAt:'desc'},{id:'desc'}],skip,take:30,select:{id:true,category:true,subject:true,status:true,ownerUnread:true,userUnread:true,lastMessageAt:true,createdAt:true,updatedAt:true,user:{select:{id:true,name:true,username:true}},_count:{select:{messages:true}},messages:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{id:true,authorType:true,body:true,createdAt:true}}}}),
      db.ticket.count({where})
    ]);
    return {items:rows,page:pageNumber,total,hasMore:skip+rows.length<total};
  }
  @Get('admin/tickets/:id') async ticketDetails(@Headers('authorization') auth:string,@Param('id') target:string){
    await owner(auth);const id=uuid(target),ticket=await db.ticket.findUnique({where:{id},include:{user:{select:{id:true,name:true,username:true}},messages:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:200}}});
    if(!ticket)throw new NotFoundException('Тикет не найден.');ticket.messages.reverse();return ticket;
  }
  @Post('admin/tickets/:id/read') async readAdminTicket(@Headers('authorization') auth:string,@Param('id') target:string){
    await owner(auth);const id=uuid(target),result=await db.ticket.updateMany({where:{id},data:{ownerUnread:false}});if(!result.count)throw new NotFoundException('Тикет не найден.');return {read:true};
  }
  @Post('admin/tickets/:id/messages') async ownerMessage(@Headers('authorization') auth:string,@Param('id') target:string,@Body() body:Record<string,unknown>){
    const actorId=await owner(auth),id=uuid(target),message=field(body,'message',2000,2);return this.updateTicket(actorId,id,{status:'ANSWERED',reply:message});
  }
  @Get('admin/audit') async audit(@Headers('authorization') auth:string,@QueryParam('page') page?:string){await owner(auth);const pageNumber=this.pageNumber(page);return {items:await db.audit.findMany({orderBy:[{createdAt:'desc'},{id:'desc'}],skip:pageNumber*30,take:30}),page:pageNumber};}
  private pageNumber(page?:string){if(page!==undefined&&!/^[0-9]{1,5}$/.test(page))throw new BadRequestException('Некорректная страница.');return Number(page||0);}
  private telegramId(value:string){if(!/^[1-9][0-9]{0,19}$/.test(value))throw new BadRequestException('Некорректный Telegram ID.');return value;}
  private async equipmentNames(ids:string[]){const unique=[...new Set(ids)];if(!unique.length)return new Map<string,string>();const nodes=await db.gpuCatalog.findMany({where:{id:{in:unique}},select:{id:true,name:true}});return new Map(nodes.map(node=>[node.id,node.name]));}
  @Patch('admin/requests/:id') async review(@Headers('authorization') auth:string,@Param('id') target:string,@Body() body:Record<string,unknown>){
    const actorId=await owner(auth),id=uuid(target),status=field(body,'status',20);if(!['REVIEWED','CLOSED'].includes(status))throw new BadRequestException();
    const decision=status==='CLOSED'?field(body,'decision',16):null,closureReason=status==='CLOSED'?field(body,'closureReason',1000,3):null;
    if(decision&&!['ACCEPTED','REJECTED'].includes(decision))throw new BadRequestException('Выберите принятие или отказ.');
    const peek=await db.rentalRequest.findUnique({where:{id},select:{userId:true,isTestOrder:true}});
    if(!peek||peek.isTestOrder)throw new NotFoundException();
    return db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 32))`;
      const current=await tx.rentalRequest.findUnique({where:{id}});if(!current)throw new NotFoundException();
      if(current.leaseId)throw new BadRequestException('Оплаченный заказ обрабатывается в разделе Orders / Epochs.');
      if(current.status==='CLOSED'){if(status==='CLOSED'&&current.decision===decision&&current.closureReason===closureReason)return presentRequest(current);throw new BadRequestException('Заявка уже закрыта.');}
      const result=await tx.rentalRequest.update({where:{id},data:{status,decision,closureReason,closedAt:status==='CLOSED'?new Date():null,userUnread:status==='CLOSED'?true:undefined}});await tx.audit.create({data:{actorId,action:`REQUEST_${decision||status}`,targetId:id}});return presentRequest(result);
    });
  }
  @Patch('admin/tickets/:id') async reply(@Headers('authorization') auth:string,@Param('id') target:string,@Body() body:Record<string,unknown>){
    const actorId=await owner(auth),id=uuid(target);return this.updateTicket(actorId,id,body);
  }
  private async updateTicket(actorId:string,id:string,body:Record<string,unknown>){
    const status=body.status===undefined?(body.reply===undefined?'IN_PROGRESS':'ANSWERED'):field(body,'status',20);
    if(!['OPEN','IN_PROGRESS','ANSWERED','CLOSED'].includes(status))throw new BadRequestException('Некорректный статус тикета.');
    const reply=body.reply===undefined?undefined:field(body,'reply',2000,2);
    return db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 33))`;
      const current=await tx.ticket.findUnique({where:{id}});if(!current)throw new NotFoundException();
      if(current.status==='CLOSED'&&status==='CLOSED'&&!reply)return current;
      if(current.status==='CLOSED'&&status!=='OPEN')throw new BadRequestException('Тикет уже закрыт. Сначала откройте его повторно.');
      const ownerMessages=reply?1:await tx.ticketMessage.count({where:{ticketId:id,authorType:'OWNER'}});
      if(['ANSWERED','CLOSED'].includes(status)&&!ownerMessages)throw new BadRequestException('Добавьте ответ пользователю перед закрытием.');
      const now=new Date();
      const ownerMessage=reply?await tx.ticketMessage.create({data:{ticketId:id,authorType:'OWNER',authorId:actorId,body:reply,createdAt:now}}):null;
      if(ownerMessage)await notify(tx,{userId:current.userId,type:'SUPPORT_REPLY',title:'Ответ поддержки',message:reply!.slice(0,500),referenceType:'SUPPORT',referenceId:id,dedupeKey:'support-message:'+ownerMessage.id});
      const notifyUser=Boolean(reply)||status==='CLOSED'||current.status==='CLOSED';
      const result=await tx.ticket.update({where:{id},data:{reply,status,ownerUnread:false,userUnread:notifyUser?true:undefined,lastMessageAt:reply?now:undefined,closedAt:status==='CLOSED'?now:null}});
      await tx.audit.create({data:{actorId,action:`SUPPORT_${status}`,targetId:id}});return result;
    });
  }
}
@Module({controllers:[Api]}) class AppModule{}
const app=await NestFactory.create<NestFastifyApplication>(AppModule,new FastifyAdapter({bodyLimit:16384,trustProxy:'127.0.0.1',logger:false}));
app.enableShutdownHooks();await db.$connect();
await app.listen(Number(process.env.PORT||3100),'127.0.0.1');
