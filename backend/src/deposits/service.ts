import {randomBytes,createHash} from 'node:crypto';
import {BadRequestException,ForbiddenException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import type {PrismaClient,TonDeposit} from '@prisma/client';
import {Address} from '@ton/ton';
import {tonConfig,usdtString,usdtUnits,friendly} from '../ton/config.js';
import {TonCenter} from '../ton/center.js';
import {jettonPayment} from '../ton/jetton.js';
import {verifyTonProof,type ProofInput} from '../ton/proof.js';

export const config=tonConfig();
export const center=new TonCenter(config);
const hash=(nonce:string)=>createHash('sha256').update(nonce).digest('hex');
const maxAge=20*60*1000;

export function safeDeposit(row:TonDeposit){return {id:row.id,invoiceId:row.invoiceId,asset:'USDT',network:'TON',amount:usdtString(row.requestedMicros),receivedAmount:row.receivedMicros===null?null:usdtString(row.receivedMicros),status:row.status,sender:friendly(row.senderAddress),recipient:friendly(row.recipientAddress),jettonMaster:friendly(row.jettonMaster),txHash:row.txHash,traceId:row.traceId,createdAt:row.createdAt,expiresAt:row.expiresAt,confirmedAt:row.confirmedAt,creditedAt:row.creditedAt};}

export class DepositsService {
 constructor(readonly db:PrismaClient){}
 allowed(_userId:string){return config.enabled;}
 async challenge(userId:string){
  const window=new Date(Date.now()-600000);
  if(await this.db.tonProofChallenge.count({where:{userId,createdAt:{gte:window}}})>=5)throw new BadRequestException('Слишком много подключений кошелька. Повторите позже.');
  const payload=randomBytes(32).toString('hex');
  await this.db.tonProofChallenge.create({data:{userId,nonceHash:hash(payload),expiresAt:new Date(Date.now()+300000)}});
  return {payload,expiresIn:300};
 }
 async verify(userId:string,input:ProofInput){
  const challenge=await this.db.tonProofChallenge.findUnique({where:{nonceHash:hash(input?.proof?.payload||'')}});
  if(!challenge||challenge.userId!==userId||challenge.consumedAt||challenge.expiresAt<=new Date())throw new BadRequestException('Подпись кошелька устарела. Подключите его снова.');
  let raw:string;
  try{raw=await verifyTonProof(input,input.proof.payload,config,center);}catch{throw new BadRequestException('Не удалось подтвердить владение TON-кошельком.');}
  return this.db.$transaction(async tx=>{
   const used=await tx.tonProofChallenge.updateMany({where:{id:challenge.id,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
   if(!used.count)throw new BadRequestException('Подпись уже использована.');
   const owner=await tx.tonWallet.findUnique({where:{address:raw}});
   if(owner&&owner.userId!==userId)throw new ForbiddenException('Кошелёк привязан к другому аккаунту.');
   const wallet=await tx.tonWallet.upsert({where:{userId},create:{userId,address:raw,network:'TON',walletApp:String(input.walletApp||'').slice(0,100)||null,verified:true},update:{address:raw,network:'TON',walletApp:String(input.walletApp||'').slice(0,100)||null,verified:true,lastConnectedAt:new Date()}});
   return {address:friendly(wallet.address),network:'TON',verified:true};
  });
 }
 async wallet(userId:string){
  const [wallet,balance,pending]=await Promise.all([
   this.db.tonWallet.findUnique({where:{userId}}),this.db.ledgerEntry.aggregate({where:{userId},_sum:{amountMicros:true}}),
   this.db.tonDeposit.count({where:{userId,status:{in:['PENDING','DETECTED','CONFIRMED']}}})
  ]);
  return {asset:'USDT',network:'TON',balance:usdtString(balance._sum.amountMicros||0n),connectedWallet:wallet?.verified?friendly(wallet.address):null,rawAddress:wallet?.verified?wallet.address:null,verified:Boolean(wallet?.verified),depositsEnabled:this.allowed(userId)&&Boolean(config.apiKey),publicDepositsEnabled:config.enabled,minAmount:usdtString(config.min),maxAmount:usdtString(config.max),pending};
 }
 async create(userId:string,body:Record<string,unknown>){
  if(!this.allowed(userId))throw new ServiceUnavailableException('Пополнение временно недоступно.');
  if(!config.apiKey)throw new ServiceUnavailableException('TON Center ещё не настроен.');
  if(!body||typeof body!=='object'||body.asset!=='USDT'||body.network!=='TON'||Object.keys(body).some(key=>!['amount','asset','network'].includes(key)))throw new BadRequestException('Принимается только USDT в сети TON.');
  let amount:bigint;
  try{amount=usdtUnits(body.amount);}catch{throw new BadRequestException('Некорректная сумма USDT.');}
  if(amount<config.min||amount>config.max)throw new BadRequestException('Сумма вне разрешённых пределов.');
  const wallet=await this.db.tonWallet.findUnique({where:{userId}});
  if(!wallet?.verified)throw new ForbiddenException('Сначала подтвердите TON-кошелёк через TON Proof.');
  const sender=Address.parse(wallet.address);
  let senderJetton;
  try{senderJetton=await center.jettonWallet(sender);}catch{throw new ServiceUnavailableException('Не удалось определить официальный USDT Jetton Wallet.');}
  const invoiceId='dep_'+randomBytes(16).toString('hex');
  const queryId=randomBytes(8).readBigUInt64BE().toString();
  const row=await this.db.$transaction(async tx=>{
   // Serialize invoice rate limits for this account; concurrent requests cannot bypass them.
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
   const currentWallet=await tx.tonWallet.findUnique({where:{userId}});
   if(!currentWallet?.verified||currentWallet.address!==sender.toRawString())throw new ForbiddenException('Кошелёк был изменён. Подключите его ещё раз.');
   const hour=new Date(Date.now()-3600000);
   if(await tx.tonDeposit.count({where:{userId,createdAt:{gte:hour}}})>=5)throw new BadRequestException('Слишком много счетов за час.');
   if(await tx.tonDeposit.count({where:{userId,status:'PENDING',expiresAt:{gt:new Date()}}})>=1)throw new BadRequestException('Сначала завершите или отмените предыдущий счёт.');
   return tx.tonDeposit.create({data:{invoiceId,userId,network:'TON',asset:'USDT',senderAddress:sender.toRawString(),recipientAddress:config.treasury.toRawString(),jettonMaster:config.master.toRawString(),requestedMicros:amount,expiresAt:new Date(Date.now()+maxAge),queryId}});
  });
  return {deposit:safeDeposit(row),transaction:jettonPayment(sender,config.treasury,senderJetton,amount,queryId,invoiceId,row.expiresAt)};
 }
 async cancel(userId:string,id:string){
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM deposits WHERE id=${id}::uuid FOR UPDATE`;
   const row=await tx.tonDeposit.findUnique({where:{id}});
   if(!row||row.userId!==userId)throw new NotFoundException('Счёт не найден.');
   if(row.status==='CANCELLED')return safeDeposit(row);
   if(row.status!=='PENDING'||row.txHash||row.detectedAt)throw new BadRequestException('Платёж уже обрабатывается и не может быть отменён.');
   const updated=await tx.tonDeposit.update({where:{id},data:{status:'CANCELLED'}});
   return safeDeposit(updated);
  });
 }
 async list(userId:string){return (await this.db.tonDeposit.findMany({where:{userId},orderBy:{createdAt:'desc'},take:50})).map(safeDeposit);}
 async get(userId:string,id:string){
  const row=await this.db.tonDeposit.findFirst({where:{id,userId}});
  if(!row)throw new NotFoundException('Депозит не найден.');return safeDeposit(row);
 }
 async admin(page:number,status?:string){
  const where=status?{status}:{};
  const [items,total,unmatched]=await Promise.all([this.db.tonDeposit.findMany({where,include:{user:{select:{id:true,name:true,username:true}}},orderBy:{createdAt:'desc'},skip:page*30,take:30}),this.db.tonDeposit.count({where}),this.db.unmatchedTonDeposit.count()]);
  return {items:items.map(row=>({...safeDeposit(row),user:row.user,ownerNotifiedAt:row.ownerNotifiedAt,queryId:row.queryId})),page,total,unmatched,hasMore:(page+1)*30<total};
 }
 async adminUnmatched(page:number){
  const [rows,total]=await Promise.all([this.db.unmatchedTonDeposit.findMany({orderBy:{detectedAt:'desc'},skip:page*30,take:30}),this.db.unmatchedTonDeposit.count()]);
  return {items:rows.map(row=>({id:row.id,txHash:row.txHash,invoiceId:row.invoiceId,sender:row.senderAddress?friendly(row.senderAddress):null,amount:row.amountMicros===null?null:usdtString(row.amountMicros),reason:row.reason,traceId:row.traceId,createdAt:row.detectedAt,status:'MANUAL_REVIEW'})),page,total,hasMore:(page+1)*30<total};
 }
 async adminDetail(id:string){const row=await this.db.tonDeposit.findUnique({where:{id},include:{user:{select:{id:true,name:true,username:true}}}});if(!row)throw new NotFoundException();return {...safeDeposit(row),user:row.user,queryId:row.queryId,metadata:row.metadata,ownerNotifiedAt:row.ownerNotifiedAt};}
}
