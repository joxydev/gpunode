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
const {BOT_TOKEN,SESSION_SECRET,OWNER_TELEGRAM_ID,DATABASE_URL}=process.env;
const AGREEMENT_VERSION='2026-09-14';
if(!BOT_TOKEN||!SESSION_SECRET||SESSION_SECRET.length<48||!OWNER_TELEGRAM_ID||!DATABASE_URL) throw Error('Missing secure runtime configuration');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:DATABASE_URL,max:4})});
function identity(auth?:string) {try{return sessionIdentity(auth,SESSION_SECRET!);}catch(e){throw new UnauthorizedException((e as Error).message);}}
async function agreed(auth?:string){const id=identity(auth);const user=await db.user.findUnique({where:{id},select:{agreementVersion:true,agreementAcceptedAt:true}});if(user?.agreementVersion!==AGREEMENT_VERSION||!user.agreementAcceptedAt)throw new ForbiddenException({code:'AGREEMENT_REQUIRED',message:'Примите пользовательское соглашение, чтобы продолжить.',version:AGREEMENT_VERSION});return id;}
async function agreedOwner(auth?:string){const id=await agreed(auth);if(id!==OWNER_TELEGRAM_ID)throw new ForbiddenException();return id;}
function field(body:Record<string,unknown>,key:string,max:number,min=1) {const value=body?.[key];if(typeof value!=='string'||value.trim().length<min||value.length>max)throw new BadRequestException(`Проверьте поле ${key}.`);return value.trim();}
function uuid(value:string) {if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new BadRequestException('Некорректный идентификатор.');return value;}
async function telegram(method:string,body:unknown){
 try{const r=await fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/'+method,{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json() as {ok:boolean};if(!r.ok||!result.ok)throw Error();}
 catch{throw new ServiceUnavailableException('Telegram временно недоступен. Повторите запрос.');}
}
@Controller('api')
class Api {
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
    return db.userLease.findMany({where:{userId:await agreed(auth)},orderBy:{createdAt:'desc'},take:100});
  }
  @Get('v1/market/:id') async marketDetail(@Param('id') id:string){
    const rows=await db.$queryRawUnsafe<CatalogRow[]>('SELECT * FROM gpu_catalog WHERE id=$1 AND is_active=TRUE',id);
    if(!rows.length)throw new NotFoundException('Нода не найдена.');return present(rows[0]);
  }
  @Post('v1/market/buy') async buy(@Headers('authorization') auth:string){
    await agreed(auth);
    throw new ServiceUnavailableException({code:'CONTRACTS_NOT_CONNECTED',message:'Аренда с оплатой откроется после подключения контрактов. Сейчас доступна заявка.'});
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
    const text=command==='/start'?'AetherMind — GPU-вычисления для ваших AI-проектов. Выберите ноду и отправьте заявку в приложении.':command==='/terms'?'Сейчас AetherMind принимает заявки без оплаты. Наличие оборудования, цена и срок доступа согласуются отдельно. Доходность не гарантируется. Условия и работа с персональными данными — в приложении.':'Поддержка AetherMind: откройте приложение и нажмите значок наушников. Обращения и ответы сохраняются в вашем аккаунте.';
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
    const id=identity(auth);const user=await db.user.findUnique({where:{id}});if(!user)throw new UnauthorizedException();
    const [requests,entries,total,refs,tickets]=await Promise.all([
      db.rentalRequest.findMany({where:{userId:id},orderBy:{createdAt:'desc'},take:50}),
      db.ledgerEntry.findMany({where:{userId:id},orderBy:{createdAt:'desc'},take:50}),
      db.ledgerEntry.aggregate({where:{userId:id},_sum:{amountMicros:true}}),
      db.user.count({where:{referrerId:id}}),
      db.ticket.findMany({where:{userId:id},orderBy:{createdAt:'desc'},take:30})
    ]);
    const accepted=user.agreementVersion===AGREEMENT_VERSION&&Boolean(user.agreementAcceptedAt);return {user:{id:user.id,name:user.name,username:user.username,isOwner:id===OWNER_TELEGRAM_ID},agreement:{version:AGREEMENT_VERSION,accepted,acceptedAt:accepted?user.agreementAcceptedAt:null},balance:microsToDecimal(total._sum.amountMicros||0n),earnedToday:null,requests,tickets,activeNodes:[],referrals:refs,entries:entries.map(e=>({...e,amountMicros:undefined,amount:microsToDecimal(e.amountMicros)})),updatedAt:new Date().toISOString()};
  }
  @Post('agreement/accept') async acceptAgreement(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const id=identity(auth),version=field(body,'version',32);if(version!==AGREEMENT_VERSION)throw new BadRequestException('Версия соглашения устарела. Обновите приложение.');
    return db.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 23))`;const current=await tx.user.findUnique({where:{id},select:{agreementVersion:true,agreementAcceptedAt:true}});if(!current)throw new UnauthorizedException();if(current.agreementVersion===version&&current.agreementAcceptedAt)return {version,accepted:true,acceptedAt:current.agreementAcceptedAt};const acceptedAt=new Date();await tx.user.update({where:{id},data:{agreementVersion:version,agreementAcceptedAt:acceptedAt}});await tx.audit.create({data:{actorId:id,action:'AGREEMENT_ACCEPTED',targetId:version}});return {version,accepted:true,acceptedAt};});
  }
  @Post('requests') async request(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const id=await agreed(auth), nodeId=field(body,'nodeId',64),profile='MANAGED',workload='Распределение мощностей и задач выполняет сервис AetherMind.',key=uuid(field(body,'idempotencyKey',36));
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
      const result=await tx.ticket.create({data:{userId,message,category,subject}});
      await tx.audit.create({data:{actorId:userId,action:'SUPPORT_CREATED',targetId:result.id}});return result;
    });
  }
  @Post('payments') async payment(@Headers('authorization') auth:string){await agreed(auth);throw new ServiceUnavailableException('Приём оплаты не подключён. Не переводите деньги по сторонним реквизитам.');}
  @Post('withdrawals') async withdrawal(@Headers('authorization') auth:string){await agreed(auth);throw new ServiceUnavailableException('Вывод не подключён. Баланс не изменён.');}
  @Get('admin') async admin(@Headers('authorization') auth:string){await agreedOwner(auth);const [users,requests,tickets]=await Promise.all([db.user.count(),db.rentalRequest.count({where:{status:{in:['REQUESTED','REVIEWED']}}}),db.ticket.count({where:{status:{in:['OPEN','IN_PROGRESS']}}})]);return {users,openRequests:requests,openTickets:tickets};}
  @Get('admin/requests') async requests(@Headers('authorization') auth:string,@QueryParam('page') page?:string){await agreedOwner(auth);const skip=this.offset(page);return {items:await db.rentalRequest.findMany({orderBy:[{createdAt:'desc'},{id:'desc'}],skip,take:30,include:{user:{select:{name:true}}}})};}
  @Get('admin/tickets') async tickets(@Headers('authorization') auth:string,@QueryParam('page') page?:string,@QueryParam('status') status?:string,@QueryParam('category') category?:string){
    await agreedOwner(auth);const skip=this.offset(page);
    if(status&&!['OPEN','IN_PROGRESS','ANSWERED','CLOSED'].includes(status))throw new BadRequestException();
    if(category&&!['QUESTION','COMPLAINT'].includes(category))throw new BadRequestException();
    return {items:await db.ticket.findMany({where:{...(status?{status}:{}),...(category?{category}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}],skip,take:30,include:{user:{select:{name:true}}}})};
  }
  @Get('admin/audit') async audit(@Headers('authorization') auth:string,@QueryParam('page') page?:string){await agreedOwner(auth);return {items:await db.audit.findMany({orderBy:[{createdAt:'desc'},{id:'desc'}],skip:this.offset(page),take:30})};}
  private offset(page?:string){if(page!==undefined&&!/^[0-9]{1,5}$/.test(page))throw new BadRequestException();return Number(page||0)*30;}
  @Patch('admin/requests/:id') async review(@Headers('authorization') auth:string,@Param('id') target:string,@Body() body:Record<string,unknown>){
    const actorId=await agreedOwner(auth),id=uuid(target),status=field(body,'status',20);if(!['REVIEWED','CLOSED'].includes(status))throw new BadRequestException();
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
    const actorId=await agreedOwner(auth),id=uuid(target),status=body.status===undefined?'ANSWERED':field(body,'status',20);
    if(!['OPEN','IN_PROGRESS','ANSWERED','CLOSED'].includes(status))throw new BadRequestException();
    const reply=body.reply===undefined?undefined:field(body,'reply',2000,2);
    return db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 33))`;
      const current=await tx.ticket.findUnique({where:{id}});if(!current)throw new NotFoundException();
      if(['ANSWERED','CLOSED'].includes(status)&&!(reply||current.reply))throw new BadRequestException('Добавьте ответ пользователю перед закрытием.');
      const result=await tx.ticket.update({where:{id},data:{reply,status}});await tx.audit.create({data:{actorId,action:`SUPPORT_${status}`,targetId:id}});return result;
    });
  }
}
@Module({controllers:[Api]}) class AppModule{}
const app=await NestFactory.create<NestFastifyApplication>(AppModule,new FastifyAdapter({bodyLimit:16384,trustProxy:'127.0.0.1',logger:false}));
app.enableShutdownHooks();await db.$connect();
await app.listen(Number(process.env.PORT||3100),'127.0.0.1');
