import {BadRequestException,NotFoundException} from '@nestjs/common';
import {Address} from '@ton/ton';
import type {Prisma,PrismaClient,WithdrawalRequest} from '@prisma/client';
import {microsToDecimal} from './security.js';
import {usdtUnits,friendly} from './ton/config.js';

export const WITHDRAWAL_TRANSITIONS:Record<string,string[]>={
 REQUESTED:['UNDER_REVIEW','REJECTED','CANCELLED'],
 UNDER_REVIEW:['APPROVED','REJECTED'],
 APPROVED:['PROCESSING','REJECTED'],
 PROCESSING:['COMPLETED'],
 COMPLETED:[],REJECTED:[],CANCELLED:[]
};
const withdrawalActions:Record<string,string>={UNDER_REVIEW:'WITHDRAWAL_REVIEW',APPROVED:'WITHDRAWAL_APPROVE',REJECTED:'WITHDRAWAL_REJECT',PROCESSING:'WITHDRAWAL_PROCESSING',COMPLETED:'WITHDRAWAL_COMPLETE'};
export type Tx=Prisma.TransactionClient;
export function notify(tx:Tx,data:{userId:string;type:string;title:string;message:string;referenceType?:string;referenceId?:string;dedupeKey:string}){
 return tx.notification.create({data});
}
export function destination(value:unknown){
 if(typeof value!=='string'||value.length!==48||!/^[A-Za-z0-9_-]+$/.test(value))throw new BadRequestException('Укажите корректный адрес TON Mainnet.');
 try{const parsed=Address.parseFriendly(value);if(parsed.isTestOnly||parsed.address.workChain!==0)throw Error();return parsed.address.toString({bounceable:false,urlSafe:true});}
 catch{throw new BadRequestException('Укажите корректный адрес TON Mainnet.');}
}
export function presentWithdrawal(row:WithdrawalRequest){return {id:row.id,asset:row.asset,network:row.network,destinationAddress:friendly(row.destinationAddress),amount:microsToDecimal(row.amountMicros),fee:row.feeMicros===null?null:microsToDecimal(row.feeMicros),netAmount:row.netAmountMicros===null?null:microsToDecimal(row.netAmountMicros),status:row.status,txHash:row.txHash,createdAt:row.createdAt,reviewedAt:row.reviewedAt,completedAt:row.completedAt,rejectionReason:row.rejectionReason};}
export function parseWithdrawal(input:Record<string,unknown>){
 if(input.asset!=='USDT'||input.network!=='TON')throw new BadRequestException('Поддерживается только USDT в TON Mainnet.');
 const address=destination(input.destinationAddress);
 let amount:bigint;try{amount=usdtUnits(input.amount);}catch{throw new BadRequestException('Некорректная сумма USDT.');}
 if(amount>100000000000000n)throw new BadRequestException('Сумма превышает лимит заявки.');
 const key=input.idempotencyKey;
 if(typeof key!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))throw new BadRequestException('Некорректный ключ заявки.');
 return {address,amount,key};
}
export async function createWithdrawal(db:PrismaClient,userId:string,input:Record<string,unknown>){
 const {address,amount,key}=parseWithdrawal(input);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
  const existing=await tx.withdrawalRequest.findUnique({where:{userId_idempotencyKey:{userId,idempotencyKey:key}}});
  if(existing){if(existing.amountMicros!==amount||existing.destinationAddress!==Address.parse(address).toRawString())throw new BadRequestException('Ключ заявки уже использован.');return presentWithdrawal(existing);}
  const balance=(await tx.ledgerEntry.aggregate({where:{userId},_sum:{amountMicros:true}}))._sum.amountMicros||0n;
  if(amount>balance)throw new BadRequestException('Недостаточно доступных средств.');
  if(await tx.withdrawalRequest.count({where:{userId,status:{in:['REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING']}}}))throw new BadRequestException('Сначала завершите текущую заявку на вывод.');
  const row=await tx.withdrawalRequest.create({data:{userId,idempotencyKey:key,asset:'USDT',network:'TON',destinationAddress:Address.parse(address).toRawString(),amountMicros:amount}});
  await tx.ledgerEntry.create({data:{userId,amountMicros:-amount,kind:'WITHDRAWAL_RESERVE',sourceId:'withdrawal-reserve:'+row.id}});
  await tx.audit.create({data:{actorId:userId,action:'WITHDRAWAL_CREATED',targetId:row.id}});
  await notify(tx,{userId,type:'WITHDRAWAL_CREATED',title:'Заявка на вывод создана',message:microsToDecimal(amount)+' USDT · TON',referenceType:'WITHDRAWAL',referenceId:row.id,dedupeKey:'withdrawal:'+row.id+':REQUESTED'});
  return presentWithdrawal(row);
 });
}
export async function updateWithdrawal(db:PrismaClient,actorId:string,id:string,input:Record<string,unknown>,owner:boolean){
 if(typeof input.status!=='string'||!Object.hasOwn(WITHDRAWAL_TRANSITIONS,input.status))throw new BadRequestException('Некорректный статус заявки.');
 const next=input.status;
 if(!owner&&next!=='CANCELLED')throw new BadRequestException('Можно отменить только новую заявку.');
 if(owner&&next==='CANCELLED')throw new BadRequestException('Заявку отменяет пользователь.');
 const peek=await db.withdrawalRequest.findUnique({where:{id},select:{userId:true}});
 if(!peek||!owner&&peek.userId!==actorId)throw new NotFoundException('Заявка не найдена.');
 return db.$transaction(async tx=>{
  // Same lock ordering as the TON watcher: user before financial rows.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${peek.userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM withdrawal_requests WHERE id=${id}::uuid FOR UPDATE`;
  const row=await tx.withdrawalRequest.findUniqueOrThrow({where:{id}});
  if(row.userId!==peek.userId)throw new NotFoundException();
  let reason:string|null=null,hash:string|null=row.txHash,fee=row.feeMicros;
  if(next==='REJECTED'){
   if(typeof input.rejectionReason!=='string'||input.rejectionReason.trim().length<3||input.rejectionReason.length>1000)throw new BadRequestException('Укажите причину отказа.');
   reason=input.rejectionReason.trim();
  }else if(input.rejectionReason!==undefined)throw new BadRequestException('Причина отказа не требуется.');
  if(input.txHash!==undefined){
   if(!owner||!['PROCESSING','COMPLETED'].includes(next)||typeof input.txHash!=='string'||!/^[a-f0-9]{64}$/i.test(input.txHash))throw new BadRequestException('Некорректный хэш транзакции TON.');
   hash=input.txHash.toLowerCase();
  }
  if(next==='COMPLETED'&&!hash)throw new BadRequestException('Для завершения нужен хэш транзакции.');
  if(hash&&hash!==row.txHash&&await tx.withdrawalRequest.findFirst({where:{txHash:hash,id:{not:id}},select:{id:true}}))throw new BadRequestException('Хэш уже использован в другой заявке.');
  if(input.fee!==undefined){
   if(!owner||!['APPROVED','PROCESSING','COMPLETED'].includes(next))throw new BadRequestException('Комиссию может указать только оператор.');
   try{fee=input.fee==='0'?0n:usdtUnits(input.fee);}catch{throw new BadRequestException('Некорректная комиссия USDT.');}
   if(fee>=row.amountMicros)throw new BadRequestException('Комиссия должна быть меньше суммы.');
  }
  if(next==='REJECTED'||next==='CANCELLED')fee=null;
  if(row.status===next){
   if(row.rejectionReason===reason&&row.txHash===hash&&row.feeMicros===fee)return presentWithdrawal(row);
   throw new BadRequestException('Статус уже установлен с другими реквизитами.');
  }
  if(!WITHDRAWAL_TRANSITIONS[row.status]?.includes(next))throw new BadRequestException('Переход между статусами недоступен.');
  const now=new Date();
  const updated=await tx.withdrawalRequest.update({where:{id},data:{status:next,rejectionReason:reason,txHash:hash,feeMicros:fee,netAmountMicros:fee===null?null:row.amountMicros-fee,reviewedAt:next==='UNDER_REVIEW'?now:undefined,completedAt:next==='COMPLETED'?now:undefined}});
  if(next==='CANCELLED'||next==='REJECTED')await tx.ledgerEntry.create({data:{userId:row.userId,amountMicros:row.amountMicros,kind:'WITHDRAWAL_RELEASE',sourceId:'withdrawal-release:'+id}});
  await tx.audit.create({data:{actorId,action:next==='CANCELLED'?'WITHDRAWAL_CANCEL':withdrawalActions[next],targetId:id}});
  await notify(tx,{userId:row.userId,type:'WITHDRAWAL_UPDATED',title:'Статус вывода изменён',message:next+' · '+microsToDecimal(row.amountMicros)+' USDT',referenceType:'WITHDRAWAL',referenceId:id,dedupeKey:'withdrawal:'+id+':'+next});
  return presentWithdrawal(updated);
 });
}
export async function activity(db:PrismaClient,userId:string,filter:string='ALL'){
 if(!['ALL','DEPOSIT','WITHDRAWAL','PURCHASE','REFUND','EPOCH','ADJUSTMENT'].includes(filter))throw new BadRequestException('Некорректный фильтр операций.');
 const [deposits,withdrawals,entries,leases]=await Promise.all([
  filter==='ALL'||filter==='DEPOSIT'?db.tonDeposit.findMany({where:{userId},orderBy:{createdAt:'desc'},take:50}):[],
  filter==='ALL'||filter==='WITHDRAWAL'?db.withdrawalRequest.findMany({where:{userId},orderBy:{createdAt:'desc'},take:50}):[],
  ['ALL','PURCHASE','REFUND','ADJUSTMENT'].includes(filter)?db.ledgerEntry.findMany({where:{userId,kind:{notIn:['DEPOSIT','DEPOSIT_CONFIRMED','CRYPTO_DEPOSIT_CONFIRMED','WITHDRAWAL_RESERVE','WITHDRAWAL_RELEASE']}},orderBy:{createdAt:'desc'},take:50}):[],
  filter==='ALL'||filter==='EPOCH'?db.userLease.findMany({where:{userId},include:{node:{select:{name:true}}},orderBy:{createdAt:'desc'},take:50}):[]
 ]);
 const items=[
  ...deposits.map(row=>({id:'deposit:'+row.id,type:'DEPOSIT',amount:microsToDecimal(row.receivedMicros||row.requestedMicros),status:row.status,network:'TON',createdAt:row.createdAt,details:{invoiceId:row.invoiceId,wallet:friendly(row.senderAddress),txHash:row.txHash,confirmedAt:row.confirmedAt}})),
  ...withdrawals.map(row=>({id:'withdrawal:'+row.id,type:'WITHDRAWAL',amount:microsToDecimal(row.amountMicros),status:row.status,network:'TON',createdAt:row.createdAt,details:{destination:friendly(row.destinationAddress),txHash:row.txHash,fee:row.feeMicros===null?null:microsToDecimal(row.feeMicros),rejectionReason:row.rejectionReason}})),
  ...entries.map(row=>({id:'ledger:'+row.id,type:row.kind==='REFUND'?'REFUND':row.kind==='PURCHASE'?'PURCHASE':'ADJUSTMENT',amount:microsToDecimal(row.amountMicros),status:'COMPLETED',network:null,createdAt:row.createdAt,details:{}})),
  ...leases.map(row=>({id:'epoch:'+row.id,type:'EPOCH',amount:null,status:row.status,network:null,createdAt:row.createdAt,details:{node:row.node.name,expiresAt:row.expiresAt}}))
 ].filter(row=>filter==='ALL'||row.type===filter).sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||b.id.localeCompare(a.id));
 return {items:items.slice(0,50)};
}
export async function requestData(db:PrismaClient,userId:string,kind:unknown){
 if(!['DATA_EXPORT_REQUEST','DATA_DELETION_REQUEST'].includes(String(kind)))throw new BadRequestException('Некорректный тип запроса.');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
  const prior=await tx.dataRequest.findFirst({where:{userId,kind:String(kind),status:{in:['REQUESTED','IN_PROGRESS']}}});
  if(prior)return prior;
  if(await tx.dataRequest.count({where:{userId,createdAt:{gt:new Date(Date.now()-86400000)}}})>=3)throw new BadRequestException('Слишком много запросов за сутки.');
  const row=await tx.dataRequest.create({data:{userId,kind:String(kind)}});
  await tx.audit.create({data:{actorId:userId,action:String(kind),targetId:row.id}});
  return row;
 });
}
