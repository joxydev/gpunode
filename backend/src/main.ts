import 'reflect-metadata';
import {Body, Controller, Get, Post, Patch, Param, Headers, Module, UnauthorizedException, ForbiddenException, BadRequestException, ServiceUnavailableException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {FastifyAdapter,NestFastifyApplication} from '@nestjs/platform-fastify';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {telegramIdentity,signSession,sessionIdentity,microsToDecimal,validWebhook} from './security.js';
import {catalog} from './catalog.js';
const {BOT_TOKEN,SESSION_SECRET,OWNER_TELEGRAM_ID,DATABASE_URL}=process.env;
if(!BOT_TOKEN||!SESSION_SECRET||SESSION_SECRET.length<48||!OWNER_TELEGRAM_ID||!DATABASE_URL) throw Error('Missing secure runtime configuration');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:DATABASE_URL,max:4})});
function identity(auth?:string) {try{return sessionIdentity(auth,SESSION_SECRET!);}catch(e){throw new UnauthorizedException((e as Error).message);}}
function owner(auth?:string) {const id=identity(auth);if(id!==OWNER_TELEGRAM_ID) throw new ForbiddenException();return id;}
function field(body:Record<string,unknown>,key:string,max:number,min=1) {const value=body?.[key];if(typeof value!=='string'||value.trim().length<min||value.length>max)throw new BadRequestException(`Проверьте поле ${key}.`);return value.trim();}
function uuid(value:string) {if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new BadRequestException('Некорректный идентификатор.');return value;}
@Controller('api')
class Api {
  @Post('telegram/webhook') async webhook(@Headers('x-telegram-bot-api-secret-token') secret:string,@Body() update:any){
    if(!validWebhook(secret,process.env.BOT_WEBHOOK_SECRET))throw new UnauthorizedException();
    if(!Number.isSafeInteger(update?.update_id)||update.update_id<0)throw new BadRequestException();
    const uid=BigInt(update.update_id);if(await db.botUpdate.findUnique({where:{id:uid}}))return {ok:true};
    const msg=update.message;
    if(msg?.chat?.type!=='private'||!Number.isSafeInteger(msg?.from?.id)||msg.from.id!==msg.chat.id||typeof msg.text!=='string')return {ok:true};
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
    return {user:{id:user.id,name:user.name,username:user.username,isOwner:id===OWNER_TELEGRAM_ID},balance:microsToDecimal(total._sum.amountMicros||0n),earnedToday:null,requests,tickets,activeNodes:[],referrals:refs,entries:entries.map(e=>({...e,amountMicros:undefined,amount:microsToDecimal(e.amountMicros)})),updatedAt:new Date().toISOString()};
  }
  @Post('requests') async request(@Headers('authorization') auth:string,@Body() body:Record<string,unknown>){
    const id=identity(auth), nodeId=field(body,'nodeId',40),profile=field(body,'profile',30),workload=field(body,'workload',1500,5),key=uuid(field(body,'idempotencyKey',36));
    if(!catalog.some(n=>n.id===nodeId&&n.status==='ON_REQUEST')||!['ECO','BALANCED','PERFORMANCE'].includes(profile))throw new BadRequestException('Нода или профиль недоступны.');
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
    const userId=identity(auth),message=field(body,'message',2000,5);
    if(await db.ticket.count({where:{userId,createdAt:{gt:new Date(Date.now()-3600000)}}})>=5)throw new BadRequestException('Не более 5 обращений в час.');
    return db.ticket.create({data:{userId,message}});
  }
  @Post('payments') payment(@Headers('authorization') auth:string){identity(auth);throw new ServiceUnavailableException('Приём оплаты не подключён. Не переводите деньги по сторонним реквизитам.');}
  @Post('withdrawals') withdrawal(@Headers('authorization') auth:string){identity(auth);throw new ServiceUnavailableException('Вывод не подключён. Баланс не изменён.');}
  @Get('admin') async admin(@Headers('authorization') auth:string){owner(auth);const [users,requests,tickets,audit]=await Promise.all([db.user.count(),db.rentalRequest.findMany({orderBy:{createdAt:'desc'},take:100,include:{user:{select:{name:true}}}}),db.ticket.findMany({orderBy:{createdAt:'desc'},take:100,include:{user:{select:{name:true}}}}),db.audit.findMany({orderBy:{createdAt:'desc'},take:100})]);return {users,requests,tickets,audit};}
  @Patch('admin/requests/:id') async review(@Headers('authorization') auth:string,@Param('id') target:string,@Body() body:Record<string,unknown>){
    const actorId=owner(auth),id=uuid(target),status=field(body,'status',20);if(!['REVIEWED','CLOSED'].includes(status))throw new BadRequestException();
    return db.$transaction(async tx=>{const result=await tx.rentalRequest.update({where:{id},data:{status}});await tx.audit.create({data:{actorId,action:`REQUEST_${status}`,targetId:id}});return result;});
  }
  @Patch('admin/tickets/:id') async reply(@Headers('authorization') auth:string,@Param('id') target:string,@Body() body:Record<string,unknown>){
    const actorId=owner(auth),id=uuid(target),reply=field(body,'reply',2000,2);
    return db.$transaction(async tx=>{const result=await tx.ticket.update({where:{id},data:{reply}});await tx.audit.create({data:{actorId,action:'SUPPORT_REPLY',targetId:id}});return result;});
  }
}
@Module({controllers:[Api]}) class AppModule{}
const app=await NestFactory.create<NestFastifyApplication>(AppModule,new FastifyAdapter({bodyLimit:16384,trustProxy:'127.0.0.1',logger:false}));
app.enableShutdownHooks();await db.$connect();
await app.listen(Number(process.env.PORT||3100),'127.0.0.1');
