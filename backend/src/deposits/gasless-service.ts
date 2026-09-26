import {createHash,randomBytes} from 'node:crypto';
import {BadRequestException,ForbiddenException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {Prisma,type PrismaClient,type TonDeposit} from '@prisma/client';
import {Address,Cell} from '@ton/ton';
import {TonApiGasless} from '../ton/gasless.js';
import {estimateMessage,validateEstimate,verifiedExternal,type SignRequest} from '../ton/gasless-messages.js';
import {buildJettonTransfer} from '../ton/jetton.js';
import {config,center} from './service.js';
import {usdtString,paymentCanary} from '../ton/config.js';

type Saved={id:string;provider:'TONAPI';protocol:string;fee:string;requestedMicros:string;totalMicros:string;relayAddress:string;createdAt:number;expiresAt:number;messageDigest:string;signRequest:SignRequest;externalBoc?:string;signTraceId?:string;relayAttemptAt?:number;relayAttempts?:number;relaySubmittedAt?:number;relayExternalHash?:string};
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
 async availability(userId:string){
  if(!this.provider.enabled||this.ownerOnly&&!paymentCanary(this.rolloutConfig,userId))return false;
  const wallet=await this.db.tonWallet.findUnique({where:{userId}});
  if(!wallet?.verified||wallet.walletVersion!=='W5'||!wallet.publicKey||!wallet.walletId)return false;
  try{return Boolean(await this.provider.relay());}catch{return false;}
 }
 private async context(id:string,userId:string){
  const row=await this.db.tonDeposit.findUnique({where:{id}});
  if(!row||row.userId!==userId)throw new NotFoundException('Счёт не найден.');
  valid(row,userId);
  if(!this.provider.enabled||this.ownerOnly&&!paymentCanary(this.rolloutConfig,userId))throw new ServiceUnavailableException('Газлесс временно недоступен. Используйте обычный перевод.');
  const wallet=await this.db.tonWallet.findUnique({where:{userId}});
  if(!wallet?.verified||wallet.walletVersion!=='W5'||!wallet.publicKey||! /^[a-f0-9]{64}$/.test(wallet.publicKey)||!wallet.walletId||! /^\d{1,10}$/.test(wallet.walletId)||BigInt(wallet.walletId)>4294967295n||wallet.address!==row.senderAddress)throw new ForbiddenException('Для газлесс требуется новый TON Proof кошелька W5.');
  return {row,wallet};
 }
 async estimate(userId:string,id:string){
  const {row,wallet}=await this.context(id,userId);
  const prior=saved(row);
  if(prior){if(prior.expiresAt<=Math.floor(Date.now()/1000))throw new BadRequestException('Оценка комиссии истекла. Создайте новый счёт.');return this.present(prior,row);}
  let relay:Address;
  try{const value=await this.provider.relay();if(!value)throw Error('USDT unsupported');relay=value;}
  catch{throw new ServiceUnavailableException('TONAPI не поддерживает USDT или временно недоступен.');}
  const sender=Address.parse(wallet.address),jetton=await center.jettonWallet(sender);
  const transfer=buildJettonTransfer({sender,treasury:config.treasury,jettonWallet:jetton,usdtAmount:row.requestedMicros,queryId:row.queryId,invoiceId:row.invoiceId,responseDestination:relay,attachAmount:config.gaslessAttach,expiresAt:row.expiresAt});
  const body=Cell.fromBase64(transfer.messages[0].payload);
  let estimate;
  try{estimate=await this.provider.estimate(sender,wallet.publicKey!,estimateMessage(jetton,config.gaslessAttach,body));}
  catch{throw new ServiceUnavailableException('Не удалось оценить комиссию в USDT. Проверьте баланс или используйте обычный перевод.');}
  let result;
  try{result=validateEstimate(estimate,{wallet:sender,jetton,treasury:config.treasury,invoiceId:row.invoiceId,queryId:row.queryId,requested:row.requestedMicros,relay,expiresAt:row.expiresAt,expectedBody:body,economicAttach:config.gaslessAttach,maxFee:config.gaslessMaxFee});}
  catch{throw new ServiceUnavailableException('TONAPI вернул неподходящий перевод. Доступен обычный способ.');}
  const total=row.requestedMicros+result.fee;
  let available:bigint;
  try{available=await this.provider.usdtBalance(sender,jetton);}catch{throw new ServiceUnavailableException('Не удалось проверить баланс USDT кошелька. Попробуйте позже или используйте обычный перевод.');}
  if(available<total)throw new BadRequestException('Недостаточно USDT: для пополнения '+usdtString(row.requestedMicros)+' USDT необходимо '+usdtString(total)+' USDT с учётом комиссии.');
  const quote:Saved={id:randomBytes(16).toString('hex'),provider:'TONAPI',protocol:estimate.protocolName,fee:result.fee.toString(),requestedMicros:row.requestedMicros.toString(),totalMicros:total.toString(),relayAddress:relay.toRawString(),createdAt:Date.now(),expiresAt:estimate.validUntil,messageDigest:createHash('sha256').update(JSON.stringify(result.signRequest)).digest('hex'),signRequest:result.signRequest};
  const stored=await this.db.$transaction(async tx=>{
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
  const {wallet}=await this.context(id,userId);
  if(!body||typeof body.estimateId!=='string'||! /^[a-f0-9]{32}$/.test(body.estimateId)||Object.keys(body).some(x=>!['estimateId','internalBoc','signTraceId'].includes(x))||body.signTraceId!==undefined&&(typeof body.signTraceId!=='string'||body.signTraceId.length>128))throw new BadRequestException('Неверный идентификатор оценки.');
  const result=await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM deposits WHERE id=${id}::uuid FOR UPDATE`;
   const current=await tx.tonDeposit.findUniqueOrThrow({where:{id}});valid(current,userId);
   const quote=saved(current);
   if(!quote||quote.id!==body.estimateId||quote.expiresAt<=Math.floor(Date.now()/1000))throw new BadRequestException('Оценка комиссии недействительна.');
   if(quote.messageDigest!==createHash('sha256').update(JSON.stringify(quote.signRequest)).digest('hex')||quote.requestedMicros!==current.requestedMicros.toString()||quote.totalMicros!==(current.requestedMicros+BigInt(quote.fee)).toString())throw new BadRequestException('Оценка комиссии повреждена.');
   if(quote.relaySubmittedAt)return {state:'submitted' as const,quote};
   let externalBoc=quote.externalBoc;
   if(externalBoc){
    if(body.internalBoc!==undefined){
     if(typeof body.internalBoc!=='string'||verifiedExternal(body.internalBoc,{wallet:Address.parse(wallet.address),publicKey:wallet.publicKey!,walletId:wallet.walletId!,signRequest:quote.signRequest})!==externalBoc)throw new BadRequestException('Подписанный перевод отличается от отправленного.');
    }
    if(quote.relayAttemptAt&&Date.now()-quote.relayAttemptAt<15000)return {state:'processing' as const,quote};
    if((quote.relayAttempts||0)>=10)throw new ServiceUnavailableException('Повторные попытки отправки приостановлены. Обратитесь в поддержку, не создавайте второй перевод.');
   }else{
    if(typeof body.internalBoc!=='string')throw new BadRequestException('Подпись кошелька отсутствует.');
    try{externalBoc=verifiedExternal(body.internalBoc,{wallet:Address.parse(wallet.address),publicKey:wallet.publicKey!,walletId:wallet.walletId!,signRequest:quote.signRequest});}
    catch{throw new BadRequestException('Подпись не соответствует счёту и оценке комиссии.');}
   }
   const updated={...quote,externalBoc,signTraceId:quote.signTraceId||(typeof body.signTraceId==='string'?body.signTraceId:undefined),relayAttemptAt:Date.now(),relayAttempts:(quote.relayAttempts||0)+1};
   await tx.tonDeposit.update({where:{id},data:{metadata:metadata(updated,current.metadata)}});
   return {state:'relay' as const,quote:updated};
  });
  if(result.state==='submitted')return {submitted:true};
  if(result.state==='processing')return {submitted:false,processing:true};
  let submitted;
  try{submitted=await this.provider.send(wallet.publicKey!,result.quote.externalBoc!);if(submitted.protocolName!==result.quote.protocol)throw Error('Relayer changed protocol');}
  catch{throw new ServiceUnavailableException('Ответ relayer не получен. Проверяйте этот счёт; повторная отправка использует ту же подпись.');}
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM deposits WHERE id=${id}::uuid FOR UPDATE`;
   const current=await tx.tonDeposit.findUniqueOrThrow({where:{id}});
   const quote=saved(current);
   if(quote?.id===result.quote.id&&!quote.relaySubmittedAt)await tx.tonDeposit.update({where:{id},data:{metadata:metadata({...quote,relaySubmittedAt:Date.now(),relayExternalHash:submitted.external||undefined},current.metadata)}});
  });
  // Relay submission is not blockchain settlement. Watcher alone credits the wallet.
  return {submitted:true};
 }
}
