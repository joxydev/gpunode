import {createHash,randomBytes} from 'node:crypto';
import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {Prisma,type PrismaClient,type TonDeposit} from '@prisma/client';
import {Address,Cell,loadMessageRelaxed} from '@ton/ton';
import {TonApiGasless} from '../ton/gasless.js';
import {estimateMessage,validateEstimate,verifiedExternal,type SignRequest} from '../ton/gasless-messages.js';
import {buildJettonTransfer} from '../ton/jetton.js';
import {config,center} from './service.js';
import {usdtString,paymentCanary,depositAccessAllows} from '../ton/config.js';

function canonical(v:unknown):unknown{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)]));return v}
export const quoteDigest=(request:SignRequest)=>createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex');
function legacyDigest(request:SignRequest){return createHash('sha256').update(JSON.stringify({network:request.network,from:request.from,validUntil:request.validUntil,messages:request.messages.map(m=>({address:m.address,amount:m.amount,payload:m.payload}))})).digest('hex')}
type Saved={id:string;provider:'TONAPI';protocol:string;fee:string;requestedMicros:string;totalMicros:string;relayAddress:string;createdAt:number;expiresAt:number;messageDigest:string;signRequest:SignRequest;seqno?:number;externalBoc?:string;signTraceId?:string;relayAttemptAt?:number;relayAttempts?:number;relaySubmittedAt?:number;relayExternalHash?:string};
const saved=(row:TonDeposit):Saved|null=>{
 const metadata=row.metadata;
 if(!metadata||Array.isArray(metadata)||typeof metadata!=='object'||!('gasless' in metadata))return null;
 return metadata.gasless as Saved;
};
function valid(row:TonDeposit,userId:string){
 if(row.userId!==userId)throw new NotFoundException('Счёт не найден.');
 if(row.status!=='PENDING'||row.expiresAt.getTime()<=Date.now())throw new BadRequestException('Счёт уже обработан или истёк.');
}
const metadata=(gasless:Saved,previous:Prisma.JsonValue)=>({...previous&&typeof previous==='object'&&!Array.isArray(previous)?previous:{},paymentMode:'GASLESS',gasless}) as Prisma.InputJsonValue;

export class GaslessDeposits {
 constructor(readonly db:PrismaClient,readonly provider=new TonApiGasless(config),readonly ownerOnly=config.gaslessSmokeOwnerOnly,readonly rolloutConfig=config){}
 private async transaction<T>(fn:(tx:any)=>Promise<T>):Promise<T>{return typeof this.db.$transaction==='function'?this.db.$transaction(fn,{timeout:90000}):fn(this.db);}
 private async locked<T>(userId:string,id:string,fn:(service:GaslessDeposits)=>Promise<T>):Promise<T>{
  const peek=await this.context(id,userId);const address=Address.parse(peek.row.senderAddress).toRawString();
  return this.transaction(async tx=>{await tx.$queryRawUnsafe('SELECT 1::int FROM pg_advisory_xact_lock(hashtextextended($1, 20261010))',address);
   const peers=await tx.tonDeposit.findMany({where:{senderAddress:address,id:{not:id},status:'PENDING'}});
   const now=Math.floor(Date.now()/1000);
   for(const peer of peers){const quote=saved(peer);if(quote&&(quote.expiresAt>now||quote.externalBoc&&quote.expiresAt+60>now))throw new ConflictException({code:'WALLET_OPERATION_PENDING',message:'Другой счёт этого кошелька ожидает подписи или проверки. Дождитесь результата.'});}
   return fn(new GaslessDeposits(tx as PrismaClient,this.provider,this.ownerOnly,this.rolloutConfig));
  });
 }
 async availability(userId:string){
  if(!depositAccessAllows(this.rolloutConfig,userId)||!this.provider.enabled||this.ownerOnly&&!paymentCanary(this.rolloutConfig,userId))return false;
  const wallet=await this.db.tonWallet.findUnique({where:{userId}});
  if(!wallet?.verified||wallet.walletVersion!=='W5'||!wallet.publicKey||!wallet.walletId)return false;
  try{return Boolean(await this.provider.relay());}catch{return false;}
 }
 private async context(id:string,userId:string){
  const row=await this.db.tonDeposit.findUnique({where:{id}});
  if(!row||row.userId!==userId)throw new NotFoundException('Счёт не найден.');
  valid(row,userId);
  if(!depositAccessAllows(this.rolloutConfig,userId)||!this.provider.enabled||this.ownerOnly&&!paymentCanary(this.rolloutConfig,userId))throw new ServiceUnavailableException('Газлесс временно недоступен. Используйте обычный перевод.');
  const wallet=await this.db.tonWallet.findUnique({where:{userId}});
  if(!wallet?.verified||wallet.walletVersion!=='W5'||!wallet.publicKey||! /^[a-f0-9]{64}$/.test(wallet.publicKey)||!wallet.walletId||! /^\d{1,10}$/.test(wallet.walletId)||BigInt(wallet.walletId)>4294967295n||wallet.address!==row.senderAddress)throw new ForbiddenException('Для газлесс требуется новый TON Proof кошелька W5.');
  return {row,wallet};
 }
 async estimate(userId:string,id:string){return this.locked(userId,id,service=>service.estimateLocked(userId,id));}
 private async estimateLocked(userId:string,id:string){
  const {row,wallet}=await this.context(id,userId);
  let prior=saved(row);const currentSeqno=await center.seqno(Address.parse(wallet.address));
  if(prior){if(prior.externalBoc)throw new ConflictException({code:'WALLET_OPERATION_PENDING',message:'Подписанный перевод ожидает проверки. Следите за этим счётом.'});if(prior.expiresAt>Math.floor(Date.now()/1000)&&prior.seqno===currentSeqno)return this.present(prior,row);const original={...row.metadata as Record<string,Prisma.JsonValue>};delete original.gasless;await this.db.tonDeposit.update({where:{id},data:{metadata:original as Prisma.InputJsonValue}});prior=null;}
  let relay:Address;
  try{const value=await this.provider.relay();if(!value)throw Error('USDT unsupported');relay=value;}
  catch{throw new ServiceUnavailableException('TONAPI не поддерживает USDT или временно недоступен.');}
  const sender=Address.parse(wallet.address),jetton=await center.jettonWallet(sender);
  const transfer=buildJettonTransfer({sender,treasury:config.treasury,jettonWallet:jetton,usdtAmount:row.requestedMicros,queryId:row.queryId,invoiceId:row.invoiceId,responseDestination:relay,attachAmount:config.gaslessAttach,forwardAmount:config.notificationForwardNano,expiresAt:row.expiresAt});
  const body=Cell.fromBase64(transfer.messages[0].payload);
  let estimate;
  try{estimate=await this.provider.estimate(sender,wallet.publicKey!,estimateMessage(jetton,config.gaslessAttach,body));}
  catch{throw new ServiceUnavailableException('Не удалось оценить комиссию в USDT. Проверьте баланс или используйте обычный перевод.');}
  let result;
  try{result=validateEstimate(estimate,{wallet:sender,jetton,treasury:config.treasury,invoiceId:row.invoiceId,queryId:row.queryId,requested:row.requestedMicros,relay,expiresAt:row.expiresAt,expectedBody:body,economicAttach:config.gaslessAttach,forwardAmount:config.notificationForwardNano,maxFee:config.gaslessMaxFee});}
  catch{throw new ServiceUnavailableException('TONAPI вернул неподходящий перевод. Доступен обычный способ.');}
  const total=row.requestedMicros+result.fee;
  let available:bigint;
  try{available=await this.provider.usdtBalance(sender,jetton);}catch{throw new ServiceUnavailableException('Не удалось проверить баланс USDT кошелька. Попробуйте позже или используйте обычный перевод.');}
  if(available<total)throw new BadRequestException('Недостаточно USDT: для пополнения '+usdtString(row.requestedMicros)+' USDT необходимо '+usdtString(total)+' USDT с учётом комиссии.');
  const quote:Saved={id:randomBytes(16).toString('hex'),provider:'TONAPI',protocol:estimate.protocolName,fee:result.fee.toString(),requestedMicros:row.requestedMicros.toString(),totalMicros:total.toString(),relayAddress:relay.toRawString(),createdAt:Date.now(),expiresAt:estimate.validUntil,seqno:currentSeqno,messageDigest:quoteDigest(result.signRequest),signRequest:result.signRequest};
  const stored=await this.transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM deposits WHERE id=${id}::uuid FOR UPDATE`;
   const current=await tx.tonDeposit.findUniqueOrThrow({where:{id}});valid(current,userId);
   const previous=saved(current);
   if(previous)return previous;
   await tx.tonDeposit.update({where:{id},data:{metadata:metadata(quote,current.metadata)}});
   return quote;
  });
  return this.present(stored,row);
 }
 private present(quote:Saved,row:TonDeposit){return {estimateId:quote.id,feeUsdt:usdtString(BigInt(quote.fee)),amountUsdt:usdtString(row.requestedMicros),totalUsdt:usdtString(row.requestedMicros+BigInt(quote.fee)),expiresAt:quote.expiresAt,signRequest:quote.signRequest};}
 async send(userId:string,id:string,body:Record<string,unknown>){
  // Persist the exact signed message before any provider I/O. A process crash cannot erase it.
  const result=await this.locked(userId,id,service=>service.sendLocked(userId,id,body));
  return this.submit(userId,id,result);
 }
 private async sendLocked(userId:string,id:string,body:Record<string,unknown>){
  const {wallet}=await this.context(id,userId);
  if(!body||typeof body.estimateId!=='string'||! /^[a-f0-9]{32}$/.test(body.estimateId)||Object.keys(body).some(x=>!['estimateId','internalBoc','signTraceId'].includes(x))||body.signTraceId!==undefined&&(typeof body.signTraceId!=='string'||body.signTraceId.length>128))throw new BadRequestException('Неверный идентификатор оценки.');
  const result=await this.transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM deposits WHERE id=${id}::uuid FOR UPDATE`;
   const current=await tx.tonDeposit.findUniqueOrThrow({where:{id}});valid(current,userId);
   const quote=saved(current);
   if(quote?.externalBoc&&(quote.expiresAt<=Math.floor(Date.now()/1000)||await center.seqno(Address.parse(wallet.address))!==quote.seqno))return {state:'processing' as const,quote};
   if(!quote||quote.id!==body.estimateId||quote.expiresAt<=Math.floor(Date.now()/1000))throw new BadRequestException('Оценка комиссии недействительна.');
   if(quote.messageDigest!==quoteDigest(quote.signRequest)&&quote.messageDigest!==legacyDigest(quote.signRequest)||quote.requestedMicros!==current.requestedMicros.toString()||quote.totalMicros!==(current.requestedMicros+BigInt(quote.fee)).toString())throw new BadRequestException('Оценка комиссии повреждена.');
   if(quote.relaySubmittedAt)return {state:'submitted' as const,quote};
   let externalBoc=quote.externalBoc;
   if(externalBoc){
    if(body.internalBoc!==undefined){
     if(typeof body.internalBoc!=='string'||verifiedExternal(body.internalBoc,{wallet:Address.parse(wallet.address),publicKey:wallet.publicKey!,walletId:wallet.walletId!,signRequest:quote.signRequest})!==externalBoc)throw new BadRequestException('Подписанный перевод отличается от отправленного.');
    }
    if(quote.relayAttemptAt&&Date.now()-quote.relayAttemptAt<15000)return {state:'processing' as const,quote};
    if((quote.relayAttempts||0)>=10)throw new ServiceUnavailableException('Повторные попытки отправки приостановлены. Обратитесь в поддержку, не создавайте второй перевод.');
   }else{
    if(quote.seqno!==await center.seqno(Address.parse(wallet.address))){const original={...current.metadata as Record<string,Prisma.JsonValue>};delete original.gasless;await tx.tonDeposit.update({where:{id},data:{metadata:original as Prisma.InputJsonValue}});return {state:'resign' as const,quote};}
    if(typeof body.internalBoc!=='string')throw new BadRequestException('Подпись кошелька отсутствует.');
    try{externalBoc=verifiedExternal(body.internalBoc,{wallet:Address.parse(wallet.address),publicKey:wallet.publicKey!,walletId:wallet.walletId!,signRequest:quote.signRequest});}
    catch{throw new BadRequestException('Подпись не соответствует счёту и оценке комиссии.');}
    const sequence=loadMessageRelaxed(Cell.fromBase64(body.internalBoc).beginParse()).body.beginParse();sequence.skip(96);if(sequence.loadUint(32)!==quote.seqno){const original={...current.metadata as Record<string,Prisma.JsonValue>};delete original.gasless;await tx.tonDeposit.update({where:{id},data:{metadata:original as Prisma.InputJsonValue}});return {state:'resign' as const,quote};}
   }
   const updated={...quote,externalBoc,signTraceId:quote.signTraceId||(typeof body.signTraceId==='string'?body.signTraceId:undefined),relayAttemptAt:Date.now(),relayAttempts:(quote.relayAttempts||0)+1};
   await tx.tonDeposit.update({where:{id},data:{metadata:metadata(updated,current.metadata)}});
   return {state:'relay' as const,quote:updated};
  });
  return {...result,publicKey:wallet.publicKey!};
 }
 private async submit(userId:string,id:string,result:{state:string;quote:Saved;publicKey:string}){
  if(result.state==='resign')throw new ConflictException({code:'WALLET_RESIGN_REQUIRED',message:'Состояние кошелька изменилось. Получите новую оценку для этого счёта и подпишите снова.'});
  if(result.state==='submitted')return {submitted:true};
  if(result.state==='processing')return {submitted:false,processing:true};
  let submitted;
  try{submitted=await this.provider.send(result.publicKey,result.quote.externalBoc!);if(submitted.protocolName!==result.quote.protocol)throw Error('Relayer changed protocol');}
  catch{throw new ServiceUnavailableException('Ответ relayer не получен. Проверяйте этот счёт; повторная отправка использует ту же подпись.');}
  await this.transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM deposits WHERE id=${id}::uuid FOR UPDATE`;
   const current=await tx.tonDeposit.findUniqueOrThrow({where:{id}});
   const quote=saved(current);
   if(quote?.id===result.quote.id&&!quote.relaySubmittedAt)await tx.tonDeposit.update({where:{id},data:{metadata:metadata({...quote,relaySubmittedAt:Date.now(),relayExternalHash:submitted.external||undefined},current.metadata)}});
  });
  // Relay submission is not blockchain settlement. Watcher alone credits the wallet.
  return {submitted:true};
 }
}
