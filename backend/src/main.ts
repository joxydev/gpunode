import 'reflect-metadata';
import {Body, Controller, Get, Post, Patch, Param, Headers, Module, UnauthorizedException, ForbiddenException, BadRequestException, ServiceUnavailableException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {FastifyAdapter,NestFastifyApplication} from '@nestjs/platform-fastify';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {telegramIdentity,signSession,sessionIdentity,microsToDecimal,validWebhook} from './security.js';
import {catalog} from './catalog.js';
import {Query as QueryParam, NotFoundException} from '@nestjs/common';
import {catalogueQuery,present,MARKET_VERSION,PURCHASES_ENABLED,type CatalogRow} from './market.js';
import {Req} from '@nestjs/common';
import type {FastifyRequest} from 'fastify';
import {createHmac} from 'node:crypto';
import {createBrowserLogin,bindBrowserLogin,decideBrowserLogin,pollBrowserLogin,loginCode} from './browser-auth.js';
import {journey,OFFER_DOCUMENT_SHA256,OFFER_NUMBER,OFFER_PUBLISHED_AT,OFFER_SIGNED_AT,OFFER_VERSION,offerTariffs} from './offer.js';
const {BOT_TOKEN,SESSION_SECRET,OWNER_TELEGRAM_ID,DATABASE_URL}=process.env;
const AGREEMENT_VERSION='2026-09-14';
const DEPOSIT_KINDS=['DEPOSIT','DEPOSIT_CONFIRMED','CRYPTO_DEPOSIT_CONFIRMED'];
const OPEN_TICKET_STATUSES=['OPEN','IN_PROGRESS','ANSWERED'];
if(!BOT_TOKEN||!SESSION_SECRET||SESSION_SECRET.length<48||!OWNER_TELEGRAM_ID||!DATABASE_URL) throw Error('Missing secure runtime configuration');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:DATABASE_URL,max:4})});
function identity(auth?:string) {try{return sessionIdentity(auth,SESSION_SECRET!);}catch(e){throw new UnauthorizedException((e as Error).message);}}
async function agreed(auth?:string){const id=identity(auth);const user=await db.user.findUnique({where:{id},select:{agreementVersion:true,agreementAcceptedAt:true}});if(user?.agreementVersion!==AGREEMENT_VERSION||!user.agreementAcceptedAt)throw new ForbiddenException({code:'AGREEMENT_REQUIRED',message:'Примите пользовательское соглашение, чтобы продолжить.',version:AGREEMENT_VERSION});return id;}
async function participating(auth?:string){const id=await agreed(auth);if(!await db.offerAcceptance.findUnique({where:{userId_version:{userId:id,version:OFFER_VERSION}}}))throw new ForbiddenException({code:'OFFER_REQUIRED',message:'Примите актуальную публичную оферту, чтобы продолжить.',version:OFFER_VERSION});return id;}
async function participatingOwner(auth?:string){const id=await participating(auth);if(id!==OWNER_TELEGRAM_ID)throw new ForbiddenException();return id;}
function field(body:Record<string,unknown>,key:string,max:number,min=1) {const value=body?.[key];if(typeof value!=='string'||value.trim().length<min||value.length>max)throw new BadRequestException(`Проверьте поле ${key}.`);return value.trim();}
function uuid(value:string) {if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new BadRequestException('Некорректный идентификатор.');return value;}
async function telegram(method:string,body:unknown){
 try{const r=await fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/'+method,{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json() as {ok:boolean};if(!r.ok||!result.ok)throw Error();}
 catch{throw new ServiceUnavailableException('Telegram временно недоступен. Повторите запрос.');}
}
@Controller('api')
class Api {
  @Get('offer') offer(){return {number:OFFER_NUMBER,version:OFFER_VERSION,publishedAt:OFFER_PUBLISHED_AT,signedAt:OFFER_SIGNED_AT,documentSha256:OFFER_DOCUMENT_SHA256,tariffs:offerTariffs,paymentsEnabled:false,accrualEnabled:false,compoundEnabled:false,currency:'USDT'};}
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
    return {version:MARKET_VERSION,nodes:rows.map(present),purchasesEnabled:PURCHASES_ENABLED,updatedAt:new Date().toISOString()};
  }
  @Get('v1/market/leases') async leases(@Headers('authorization') auth:string){
    return db.userLease.findMany({where:{userId:await participating(auth)},orderBy:{createdAt:'desc'},take:100});
  }
  @Get('v1/market/:id') async marketDetail(@Param('id') id:string){
    const rows=await db.$queryRawUnsafe<CatalogRow[]>('SELECT * FROM gpu_catalog WHERE id=$1 AND is_active=TRUE',id);
    if(!rows.length)throw new NotFoundException('Нода не найдена.');return present(rows[0]);
  }
  @Post('v1/market/buy') async buy(@Headers('authorization') auth:string){
    await participating(auth);
    throw new ServiceUnavailableException({code:'PAYMENTS_DISABLED',message:'Внутренние списания выключены. Сначала будет подключено подтверждённое пополнение, затем заказ тарифа.'});
  }
  @Post('telegram/webhook') async webhook(@Headers('x-telegram-bot-api-secret-token') secret:string,@Body() update:any){
    if(!validWebhook(secret,process.env.BOT_WEBHOOK_SECRET))throw new UnauthorizedException();
    if(!Number.isSafeInteger(update?.update_id)||update.update_id<0)throw new BadRequestException();
    const uid=BigInt(update.update_id);if(await db.botUpdate.findUnique({where:{id:uid}}))return {ok:true};
    const callback=update.callback_query;
    if(callback){
      const match=typeof callback.data==='string'?callback.data.match(/^bl:([yn]):([0-9a-f-]{36})$/):null;
      if(!match||typeof callback.id!=='string'||!Number.isSafeInteger(callback.from?.id)||callback.message?.chat?.type!=='private'||callback.message.chat.id!==callback.from.id)return {ok:true};
      const changed=await db.$transaction(tx=>decideBrowserLogin((sql,params=[])=>tx.$queryRawUnsafe(sql,...params),match[2],{id:String(callback.from.id),name:String(callback.from.first_name||'Пользователь'),username:callback.from.username},match[1]==='y'));
      await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:changed?(match[1]==='y'?'Вход подтверждён. Вернитесь в браузер.':'Вход отклонён.'):'Запрос уже обработан или истёк.',show_alert:true});
      await db.botUpdate.upsert({where:{id:uid},create:{id:uid},update:{}});return {ok:true};
    }
    const msg=update.message;
    if(msg?.chat?.type!=='private'||!Number.isSafeInteger(msg?.from?.id)||msg.from.id!==msg.chat.id||typeof msg.text!=='string')return {ok:true};
    const browser=msg.text.match(/^\/start(?:@[a-zA-Z0-9_]+)?\s+login_([0-9a-f-]{36})$/);
    if(browser){
      const bound=await db.$transaction(tx=>bindBrowserLogin((sql,params=[])=>tx.$queryRawUnsafe(sql,...params),browser[1],String(msg.from.id)));
      await telegram('sendMessage',{chat_id:msg.chat.id,text:bound?`Вход в AetherMind в браузере ${process.env.PUBLIC_URL}.\nКод запроса: ${loginCode(browser[1])}.\nСверьте код с открытой вкладкой. Подтверждайте только вход, который вы начали сами. После подтверждения вернитесь в ту же вкладку.`:'Запрос входа истёк или уже обработан. Начните вход заново в браузере.',...(bound?{reply_markup:{inline_keyboard:[[{text:'Подтвердить вход',callback_data:`bl:y:${browser[1]}`},{text:'Отклонить',callback_data:`bl:n:${browser[1]}`}]]}}:{})});
      await db.botUpdate.upsert({where:{id:uid},create:{id:uid},update:{}});return {ok:true};
    }
    const command=msg.text.split(/[\s@]/)[0];if(!['/start','/support','/terms','/paysupport'].includes(command))return {ok:true};
    const userId=String(msg.from.id),ref=msg.text.match(/^\/start\s+r_([1-9][0-9]{0,15})$/)?.[1];
    if(ref&&ref!==userId&&!await db.user.findUnique({where:{id:userId}})&&await db.user.findUnique({where:{id:ref}}))await db.invite.upsert({where:{telegramId:userId},create:{telegramId:userId,referrerId:ref},update:{}});
    const text=command==='/start'?'AetherMind — участие в коммерческом DePIN-кластере GPU. Примите оферту, выберите фиксированный тариф и следите за этапами в профиле.':command==='/terms'?'Действующие категории: Node Alpha — 50 USDT, Cluster Beta — 300 USDT, Enterprise POD — 1 200 USDT. Quantum Array находится в разработке. Платежи и начисления пока выключены; полные условия доступны в приложении.':'Поддержка AetherMind: откройте приложение и нажмите значок наушников. Обращения и ответы сохраняются в вашем профиле.';
    try{const r=await fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/sendMessage',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:msg.chat.id,text,reply_markup:{inline_keyboard:[[{text:'Открыть AetherMind',web_app:{url:process.env.PUBLIC_URL+'/'}}]]}})});const result=await r.json() as {ok?:boolean};if(!result.ok)throw Error();}catch{throw new ServiceUnavailableException('Bot delivery unavailable');}
    await db.botUpdate.upsert({where:{id:uid},create:{id:uid},update:{}});return {ok:true};
  }
  @Get('health') async health(){await db.$queryRaw`SELECT 1`;return {status:'ok',app:'aethermind',commit:process.env.APP_COMMIT||'local'};}
  @Get('catalog') list(){return {nodes:catalog,load:null,providerConnected:false,paymentsEnabled:false,botUsername:process.env.BOT_USERNAME||'',stage:'REQUESTS'};}
  @Post('auth/telegram') async login(@Body() body:Record<string,unknown>){
    let tg;try{tg=telegramIdentity(field(body,'initData',8192),BOT_TOKEN!);}catch(e){throw new UnauthorizedException((e as Error).message);}
    const pending=await db.invite.findUnique({where:{telegramId:tg.id}});
    const refId=tg.referrer||pending?.referrerId;
    const ref=refId&&refId!==tg.id ? await db.user.findUnique({where:{id:refId}}):null;
    const user=await db.user.upsert({where:{id:tg.id},create:{id:tg.id,name:tg.name,username:tg.username,referrerId:ref?.id},update:{name:tg.name,username:tg.username}});
    return {token:signSession(user.id,SESSION_SECRET!),expiresIn:21600};
  }
  @Get('me') async me(@Headers('authorization') auth:string){
    const id=identity(auth);const user=await db.user.findUnique({where:{id},include:{selectedTariff:true,offerAcceptances:{where:{version:OFFER_VERSION},take:1}}});if(!user)throw new UnauthorizedException();
    const [requests,entries,total,refs,tickets,leases,unreadSupport]=await Promise.all([
      db.rentalRequest.findMany({where:{userId:id},orderBy:{createdAt:'desc'},take:50}),
      db.ledgerEntry.findMany({where:{userId:id},orderBy:{createdAt:'desc'},take:50}),
      db.ledgerEntry.aggregate({where:{userId:id},_sum:{amountMicros:true}}),
      db.user.findMany({where:{referrerId:id},orderBy:{createdAt:'desc'},take:100,select:{id:true,createdAt:true,selectedTariffId:true,offerAcceptances:{where:{version:OFFER_VERSION},select:{id:true},take:1},leases:{where:{status:{in:['PROVISIONING','ACTIVE','OVERCLOCKED']}},select:{id:true},take:1}}}),
      db.ticket.findMany({where:{userId:id},orderBy:[{lastMessageAt:'desc'},{id:'desc'}],take:30,select:{id:true,category:true,subject:true,status:true,userUnread:true,lastMessageAt:true,createdAt:true,updatedAt:true,_count:{select:{messages:true}},messages:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{id:true,authorType:true,body:true,createdAt:true}}}}),
      db.userLease.findMany({where:{userId:id},orderBy:{createdAt:'desc'},take:30,include:{node:{select:{name:true}}}}),
      db.ticket.count({where:{userId:id,userUnread:true}})
    ]);
    const accepted=user.agreementVersion===AGREEMENT_VERSION&&Boolean(user.agreementAcceptedAt),offerAcceptance=user.offerAcceptances[0]||null;
    const balanceMicros=total._sum.amountMicros||0n,selected=offerTariffs.find(t=>t.nodeId===user.selectedTariffId)||null;
    const funded=Boolean(selected)&&balanceMicros>=BigInt(selected!.depositUsdt)*1000000n;
    const ordered=leases.some(l=>['PROVISIONING','ACTIVE','OVERCLOCKED','EXPIRED'].includes(l.status));
    const epochComplete=leases.some(l=>l.status==='EXPIRED'||new Date(l.expiresAt)<=new Date());
    const referralItems=refs.map(r=>{const active=Boolean(r.leases.length),selectedTariff=Boolean(r.selectedTariffId),offerAccepted=Boolean(r.offerAcceptances.length);return {id:createHmac('sha256',SESSION_SECRET!).update('ref:'+r.id).digest('hex').slice(0,12),label:'Участник '+createHmac('sha256',SESSION_SECRET!).update(r.id).digest('hex').slice(0,4).toUpperCase(),stage:active?'ACTIVE':selectedTariff?'TARIFF_SELECTED':offerAccepted?'OFFER_ACCEPTED':'REGISTERED',joinedAt:r.createdAt};});
    return {user:{id:user.id,name:user.name,username:user.username,isOwner:id===OWNER_TELEGRAM_ID},agreement:{version:AGREEMENT_VERSION,accepted,acceptedAt:accepted?user.agreementAcceptedAt:null},offer:{number:OFFER_NUMBER,version:OFFER_VERSION,documentSha256:OFFER_DOCUMENT_SHA256,accepted:Boolean(offerAcceptance),acceptedAt:offerAcceptance?.acceptedAt||null},balance:microsToDecimal(balanceMicros),earnedToday:null,selectedTariff:selected?{...selected,selectedAt:user.selectedTariffAt}:null,journey:journey({selected:Boolean(selected),funded,ordered,epochComplete}),requests,tickets,notifications:{unreadSupport},activeNodes:leases,referrals:{total:referralItems.length,active:referralItems.filter(r=>r.stage==='ACTIVE').length,items:referralItems,rewardConfigured:false},entries:entries.map(e=>({...e,amountMicros:undefined,amount:microsToDecimal(e.amountMicros)})),paymentsEnabled:false,accrualEnabled:false,updatedAt:new Date().toISOString()};
  }
  @Post('agreement/accept') async acceptAgreement(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const id=identity(auth),version=field(body,'version',32);if(version!==AGREEMENT_VERSION)throw new BadRequestException('Версия соглашения устарела. Обновите приложение.');
    return db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 23))`;const current=await tx.user.findUnique({where:{id},select:{agreementVersion:true,agreementAcceptedAt:true}});if(!current)throw new UnauthorizedException();if(current.agreementVersion===version&&current.agreementAcceptedAt)return {version,accepted:true,acceptedAt:current.agreementAcceptedAt};const acceptedAt=new Date();await tx.user.update({where:{id},data:{agreementVersion:version,agreementAcceptedAt:acceptedAt}});await tx.audit.create({data:{actorId:id,action:'AGREEMENT_ACCEPTED',targetId:version}});return {version,accepted:true,acceptedAt};});
  }
  @Post('offer/accept') async acceptOffer(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>,@Req() req:FastifyRequest){
    const userId=await agreed(auth),version=field(body,'version',64),documentSha256=field(body,'documentSha256',64);
    if(version!==OFFER_VERSION||documentSha256!==OFFER_DOCUMENT_SHA256||body.readConfirmed!==true)throw new BadRequestException('Оферта изменилась или не прочитана полностью. Обновите приложение.');
    const clientHash=createHmac('sha256',SESSION_SECRET!).update(`${req.ip}\n${String(req.headers['user-agent']||'')}`).digest('hex');
    return db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 88))`;const current=await tx.offerAcceptance.findUnique({where:{userId_version:{userId,version}}});if(current)return {version,accepted:true,acceptedAt:current.acceptedAt};const row=await tx.offerAcceptance.create({data:{userId,version,documentSha256,clientHash}});await tx.audit.create({data:{actorId:userId,action:'PUBLIC_OFFER_ACCEPTED',targetId:version}});return {version,accepted:true,acceptedAt:row.acceptedAt};});
  }
  @Post('profile/tariff') async selectTariff(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const userId=await participating(auth),nodeId=field(body,'nodeId',64),known=offerTariffs.find(t=>t.nodeId===nodeId);
    if(!known||!known.available)throw new BadRequestException('Этот тариф пока недоступен для выбора.');
    return db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 89))`;if(await tx.userLease.count({where:{userId,status:{in:['PROVISIONING','ACTIVE','OVERCLOCKED']}}}))throw new BadRequestException('Нельзя изменить тариф при действующем Epoch.');const current=await tx.user.findUnique({where:{id:userId},select:{selectedTariffId:true,selectedTariffAt:true}});if(!current)throw new UnauthorizedException();if(current.selectedTariffId===nodeId)return {selected:true,tariff:known,selectedAt:current.selectedTariffAt};const selectedAt=new Date();await tx.user.update({where:{id:userId},data:{selectedTariffId:nodeId,selectedTariffAt:selectedAt}});await tx.audit.create({data:{actorId:userId,action:'TARIFF_SELECTED',targetId:nodeId}});return {selected:true,tariff:known,selectedAt};});
  }
  @Post('requests') async request(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const id=await participating(auth), nodeId=field(body,'nodeId',64),profile='MANAGED',workload='Распределение мощностей и задач выполняет сервис AetherMind.',key=uuid(field(body,'idempotencyKey',36));
    const marketNode=await db.gpuCatalog.findUnique({where:{id:nodeId}});
    const eligible=marketNode?marketNode.isActive&&!marketNode.isExperimental&&(!marketNode.supplyKnown||marketNode.availableSupply>0):catalog.some(n=>n.id===nodeId&&n.status==='ON_REQUEST');
    if(!eligible)throw new BadRequestException('Нода недоступна.');
    const prior=await db.rentalRequest.findUnique({where:{userId_idempotencyKey:{userId:id,idempotencyKey:key}}});if(prior)return prior;
    // One open request per user: transaction-level advisory lock prevents concurrent duplicates.
    return db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
      const same=await tx.rentalRequest.findUnique({where:{userId_idempotencyKey:{userId:id,idempotencyKey:key}}});if(same)return same;
      if(await tx.rentalRequest.count({where:{userId:id,status:{in:['REQUESTED','REVIEWED']}}}))throw new BadRequestException('У вас уже есть открытая заявка. Напишите в поддержку.');
      const result=await tx.rentalRequest.create({data:{userId:id,nodeId,profile,workload,idempotencyKey:key}});
      await tx.audit.create({data:{actorId:id,action:'REQUEST_CREATED',targetId:result.id}});return result;
    });
  }
  @Post('support') async support(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const userId=await agreed(auth),message=field(body,'message',2000,5);
    const category=body.category===undefined?'QUESTION':field(body,'category',16),subject=body.subject===undefined?'Обращение':field(body,'subject',120,3);
    if(!['QUESTION','COMPLAINT'].includes(category))throw new BadRequestException('Выберите тип обращения.');
    return db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 31))`;
      if(await tx.ticket.count({where:{userId,createdAt:{gt:new Date(Date.now()-3600000)}}})>=5)throw new BadRequestException('Не более 5 обращений в час.');
      const now=new Date();
      const result=await tx.ticket.create({data:{userId,message,category,subject,lastMessageAt:now,ownerUnread:true,userUnread:false,messages:{create:{authorType:'USER',authorId:userId,body:message,createdAt:now}}}});
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
  @Post('payments') async payment(@Headers('authorization') auth:string){await participating(auth);throw new ServiceUnavailableException('Пополнение пока не подключено. Не переводите средства по реквизитам из сообщений.');}
  @Post('withdrawals') async withdrawal(@Headers('authorization') auth:string){await participating(auth);throw new ServiceUnavailableException('Вывод пока не подключён. Учётный баланс не изменён.');}
  @Get('admin') async admin(@Headers('authorization') auth:string){
    await participatingOwner(auth);
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
    await participatingOwner(auth);const pageNumber=this.pageNumber(page),skip=pageNumber*30,query=(q||'').trim();
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
    await participatingOwner(auth);const id=this.telegramId(target),referralPage=this.pageNumber(refPage);
    const user=await db.user.findUnique({where:{id},include:{selectedTariff:{select:{id:true,name:true,priceUsdt:true,contractDays:true}},offerAcceptances:{where:{version:OFFER_VERSION},select:{version:true,acceptedAt:true},take:1}}});
    if(!user)throw new NotFoundException('Пользователь не найден.');
    const [balance,deposits,invited,invitedCount,requests,leases,ticketTotal,ticketOpen]=await Promise.all([
      db.ledgerEntry.aggregate({where:{userId:id},_sum:{amountMicros:true}}),
      db.ledgerEntry.aggregate({where:{userId:id,kind:{in:DEPOSIT_KINDS},amountMicros:{gt:0n}},_sum:{amountMicros:true}}),
      db.user.findMany({where:{referrerId:id},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:referralPage*100,take:100,select:{id:true,name:true,username:true,createdAt:true,selectedTariff:{select:{id:true,name:true}}}}),
      db.user.count({where:{referrerId:id}}),
      db.rentalRequest.findMany({where:{userId:id},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100}),
      db.userLease.findMany({where:{userId:id},orderBy:{createdAt:'desc'},take:100,include:{node:{select:{name:true}}}}),
      db.ticket.count({where:{userId:id}}),
      db.ticket.count({where:{userId:id,status:{in:OPEN_TICKET_STATUSES}}})
    ]);
    const nodes=await this.equipmentNames(requests.map(request=>request.nodeId));
    return {user:{id:user.id,name:user.name,username:user.username,createdAt:user.createdAt,referrerId:user.referrerId},statistics:{invitedCount,deposited:microsToDecimal(deposits._sum.amountMicros||0n),balance:microsToDecimal(balance._sum.amountMicros||0n),tickets:ticketTotal,openTickets:ticketOpen},documents:{agreementAcceptedAt:user.agreementAcceptedAt,offerAcceptedAt:user.offerAcceptances[0]?.acceptedAt||null},selectedTariff:user.selectedTariff,invited,referrals:{page:referralPage,total:invitedCount,hasMore:(referralPage+1)*100<invitedCount},requests:requests.map(request=>({...request,equipment:{id:request.nodeId,name:nodes.get(request.nodeId)||request.nodeId}})),leases};
  }
  @Get('admin/requests') async requests(@Headers('authorization') auth:string,@QueryParam('page') page?:string,@QueryParam('status') status?:string,@QueryParam('payment') payment?:string){
    await participatingOwner(auth);const pageNumber=this.pageNumber(page),skip=pageNumber*30;
    if(status&&!['REQUESTED','REVIEWED','CLOSED'].includes(status))throw new BadRequestException('Некорректный статус заявки.');
    if(payment&&!['WAITING','PAID'].includes(payment))throw new BadRequestException('Некорректный статус платежа.');
    const where={...(status?{status}:{}),...(payment?{paymentStatus:payment}:{})};
    const [rows,total]=await Promise.all([db.rentalRequest.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip,take:30,include:{user:{select:{id:true,name:true,username:true}}}}),db.rentalRequest.count({where})]);
    const nodes=await this.equipmentNames(rows.map(row=>row.nodeId));
    return {items:rows.map(row=>({...row,equipment:{id:row.nodeId,name:nodes.get(row.nodeId)||row.nodeId}})),page:pageNumber,total,hasMore:skip+rows.length<total};
  }
  @Get('admin/tickets') async tickets(@Headers('authorization') auth:string,@QueryParam('page') page?:string,@QueryParam('status') status?:string,@QueryParam('category') category?:string){
    await participatingOwner(auth);const pageNumber=this.pageNumber(page),skip=pageNumber*30;
    if(status&&!['OPEN','IN_PROGRESS','ANSWERED','CLOSED'].includes(status))throw new BadRequestException();
    if(category&&!['QUESTION','COMPLAINT'].includes(category))throw new BadRequestException();
    const where={...(status?{status}:{}),...(category?{category}:{})};
    const [rows,total]=await Promise.all([
      db.ticket.findMany({where,orderBy:[{lastMessageAt:'desc'},{id:'desc'}],skip,take:30,select:{id:true,category:true,subject:true,status:true,ownerUnread:true,userUnread:true,lastMessageAt:true,createdAt:true,updatedAt:true,user:{select:{id:true,name:true,username:true}},_count:{select:{messages:true}},messages:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{id:true,authorType:true,body:true,createdAt:true}}}}),
      db.ticket.count({where})
    ]);
    return {items:rows,page:pageNumber,total,hasMore:skip+rows.length<total};
  }
  @Get('admin/tickets/:id') async ticketDetails(@Headers('authorization') auth:string,@Param('id') target:string){
    await participatingOwner(auth);const id=uuid(target),ticket=await db.ticket.findUnique({where:{id},include:{user:{select:{id:true,name:true,username:true}},messages:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:200}}});
    if(!ticket)throw new NotFoundException('Тикет не найден.');ticket.messages.reverse();return ticket;
  }
  @Post('admin/tickets/:id/read') async readAdminTicket(@Headers('authorization') auth:string,@Param('id') target:string){
    await participatingOwner(auth);const id=uuid(target),result=await db.ticket.updateMany({where:{id},data:{ownerUnread:false}});if(!result.count)throw new NotFoundException('Тикет не найден.');return {read:true};
  }
  @Post('admin/tickets/:id/messages') async ownerMessage(@Headers('authorization') auth:string,@Param('id') target:string,@Body() body:Record<string,unknown>){
    const actorId=await participatingOwner(auth),id=uuid(target),message=field(body,'message',2000,2);return this.updateTicket(actorId,id,{status:'ANSWERED',reply:message});
  }
  @Get('admin/audit') async audit(@Headers('authorization') auth:string,@QueryParam('page') page?:string){await participatingOwner(auth);const pageNumber=this.pageNumber(page);return {items:await db.audit.findMany({orderBy:[{createdAt:'desc'},{id:'desc'}],skip:pageNumber*30,take:30}),page:pageNumber};}
  private pageNumber(page?:string){if(page!==undefined&&!/^[0-9]{1,5}$/.test(page))throw new BadRequestException('Некорректная страница.');return Number(page||0);}
  private telegramId(value:string){if(!/^[1-9][0-9]{0,19}$/.test(value))throw new BadRequestException('Некорректный Telegram ID.');return value;}
  private async equipmentNames(ids:string[]){const unique=[...new Set(ids)];if(!unique.length)return new Map<string,string>();const nodes=await db.gpuCatalog.findMany({where:{id:{in:unique}},select:{id:true,name:true}});return new Map(nodes.map(node=>[node.id,node.name]));}
  @Patch('admin/requests/:id') async review(@Headers('authorization') auth:string,@Param('id') target:string,@Body() body:Record<string,unknown>){
    const actorId=await participatingOwner(auth),id=uuid(target),status=field(body,'status',20);if(!['REVIEWED','CLOSED'].includes(status))throw new BadRequestException();
    const decision=status==='CLOSED'?field(body,'decision',16):null,closureReason=status==='CLOSED'?field(body,'closureReason',1000,3):null;
    if(decision&&!['ACCEPTED','REJECTED'].includes(decision))throw new BadRequestException('Выберите принятие или отказ.');
    return db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 32))`;
      const current=await tx.rentalRequest.findUnique({where:{id}});if(!current)throw new NotFoundException();
      if(current.status==='CLOSED'){if(status==='CLOSED'&&current.decision===decision&&current.closureReason===closureReason)return current;throw new BadRequestException('Заявка уже закрыта.');}
      const result=await tx.rentalRequest.update({where:{id},data:{status,decision,closureReason,closedAt:status==='CLOSED'?new Date():null}});await tx.audit.create({data:{actorId,action:`REQUEST_${decision||status}`,targetId:id}});return result;
    });
  }
  @Patch('admin/tickets/:id') async reply(@Headers('authorization') auth:string,@Param('id') target:string,@Body() body:Record<string,unknown>){
    const actorId=await participatingOwner(auth),id=uuid(target);return this.updateTicket(actorId,id,body);
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
      if(reply)await tx.ticketMessage.create({data:{ticketId:id,authorType:'OWNER',authorId:actorId,body:reply,createdAt:now}});
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
