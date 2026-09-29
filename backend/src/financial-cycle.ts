import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {Prisma,type PrismaClient,type UserLease} from '@prisma/client';
import {financialAccess,financialFlag,financialOffer} from './financial-offer.js';
import {accrueDay,calculateEarlyUnbondingFee,completedIntervals,COMPOUND_CYCLE_DAYS,DAY_MS} from './epoch-rules.js';
import {fixed,scaled} from './market.js';
import {offerTariffs} from './offer.js';
import {microsToDecimal} from './security.js';
import {notify,type Tx} from './production.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function leaseId(value:string){if(!uuid.test(value))throw new BadRequestException('Некорректный идентификатор.');return value;}
function key(value:unknown){if(typeof value!=='string'||!uuid.test(value))throw new BadRequestException('Некорректный ключ заявки.');return value;}
function failure(code:string,status:'bad'|'conflict'|'unavailable'='bad'):never{
 const body={code,message:code};
 if(status==='unavailable')throw new ServiceUnavailableException(body);
 if(status==='conflict')throw new ConflictException(body);
 throw new BadRequestException(body);
}
function flag(name:'PURCHASES'|'EPOCH_ACTIVATION'|'ACCRUAL'|'COMPOUND'|'EARLY_UNBONDING',userId?:string){
 if(!financialFlag(name))failure(name==='PURCHASES'?'PURCHASES_PAUSED':name==='ACCRUAL'?'ACCRUAL_PAUSED':name==='EARLY_UNBONDING'?'EARLY_UNBONDING_DISABLED':name+'_PAUSED','unavailable');
 if(userId&&!financialAccess(userId))failure(name+'_PAUSED','unavailable');
}
function requireSnapshot(row:UserLease){
 if(!row.offerVersion||!row.offerDocumentSha256||!row.principalMicros||!row.baseDailyRateBps||!row.contractDays||!row.mode||!row.termsSnapshot)
  failure('LEGACY_TERMS_REVIEW','conflict');
 return {principal:row.principalMicros!,rate:row.mode==='COMPOUND'?row.compoundDailyRateBps!:row.baseDailyRateBps!,days:row.contractDays!};
}
export function presentLease(row:UserLease&{node?:{name:string}}){
 const modern=Boolean(row.offerVersion);
 return {id:row.id,userId:row.userId,nodeId:row.nodeId,node:row.node,status:row.status,createdAt:row.createdAt,
  expiresAt:row.epochEndsAt||row.expiresAt,activatedAt:row.activatedAt,epochEndsAt:row.epochEndsAt,completedAt:row.completedAt,
  offerVersion:row.offerVersion,mode:row.mode,principal:row.principalMicros===null?null:microsToDecimal(row.principalMicros),
  baseDailyRateBps:row.baseDailyRateBps,compoundDailyRateBps:row.compoundDailyRateBps,contractDays:row.contractDays,
  settledDays:row.settledDays,baseAccrued:modern?microsToDecimal(row.baseAccruedMicros):null,
  compoundCapital:row.compoundPrincipalMicros===null?null:microsToDecimal(row.compoundPrincipalMicros),
  compoundProfit:modern?microsToDecimal(row.compoundProfitMicros):null,
  currentCompoundBlock:row.currentCompoundBlock,compoundBlockEndsAt:row.compoundBlockEndsAt,
  unbondFee:row.unbondFeeMicros===null?null:microsToDecimal(row.unbondFeeMicros),
  legacyTermsReview:!modern};
}
async function lockUser(tx:Tx,userId:string){
 const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
 if(!rows.length)throw new NotFoundException('Пользователь не найден.');
}
async function lockLease(tx:Tx,id:string){
 await tx.$queryRaw`SELECT id FROM user_leases WHERE id=${id}::uuid FOR UPDATE`;
 return tx.userLease.findUnique({where:{id}});
}
async function restoreSupply(tx:Tx,row:UserLease,now:Date){
 if(row.supplyReleasedAt)return;
 const result=await tx.$queryRaw<{id:string}[]>`UPDATE gpu_catalog SET available_supply=available_supply+1
  WHERE id=${row.nodeId} AND available_supply<total_supply RETURNING id`;
 if(result.length!==1)failure('SUPPLY_RECONCILIATION_REQUIRED','conflict');
 await tx.userLease.update({where:{id:row.id},data:{supplyReleasedAt:now}});
}
export async function purchase(db:PrismaClient,userId:string,input:Record<string,unknown>){
 flag('PURCHASES',userId);
 const nodeId=input.nodeId,mode=input.compoundEnabled===true?'COMPOUND':'BASE',idempotencyKey=key(input.idempotencyKey);
 if(typeof nodeId!=='string'||!/^NODE_[A-Z0-9_]{2,32}$/.test(nodeId)||typeof input.compoundEnabled!=='boolean')throw new BadRequestException('Проверьте тариф и режим.');
 if(mode==='COMPOUND')flag('COMPOUND',userId);
 const offer=financialOffer();if(!offer)failure('CURRENT_OFFER_REQUIRED','unavailable');
 return db.$transaction(async tx=>{
  await lockUser(tx,userId);
  const prior=await tx.userLease.findUnique({where:{userId_idempotencyKey:{userId,idempotencyKey}}});
  if(prior){if(prior.nodeId!==nodeId||prior.mode!==mode)failure('ORDER_ALREADY_EXISTS','conflict');return presentLease(prior);}
  const acceptance=await tx.offerAcceptance.findUnique({where:{userId_version:{userId,version:offer.version}}});
  if(acceptance?.documentSha256!==offer.sha256)throw new ForbiddenException({code:'CURRENT_OFFER_REQUIRED',message:'Примите новую редакцию оферты для заказа.',version:offer.version});
  await tx.$queryRaw`SELECT id FROM gpu_catalog WHERE id=${nodeId} FOR UPDATE`;
  const catalog=await tx.gpuCatalog.findUnique({where:{id:nodeId}}),tariff=offerTariffs.find(t=>t.nodeId===nodeId&&t.available);
  if(!catalog||!tariff||!catalog.isActive||catalog.isExperimental||!catalog.supplyKnown||!catalog.contractReference)failure('PURCHASES_PAUSED','unavailable');
  const principal=scaled(catalog.priceUsdt.toString(),2)*10000n;
  const baseRate=Number(scaled(catalog.dailyYieldPercent.toString(),2));
  const compoundRate=catalog.compoundBoostPercent===null?null:Number(scaled(catalog.compoundBoostPercent.toString(),2));
  // Neither an altered catalogue nor an unsigned draft can silently change the published tariff.
  if(principal!==BigInt(tariff!.depositUsdt)*1000000n||catalog.contractDays!==tariff!.days||baseRate!==Number(scaled(tariff!.dailyPercent!,2))||
   compoundRate!==Number(scaled(tariff!.compoundPercent!,2)))failure('CATALOG_TERMS_MISMATCH','unavailable');
  if(catalog.availableSupply<1)failure('SOLD_OUT','conflict');
  if(await tx.userLease.count({where:{userId,status:{in:['PROVISIONING','ACTIVE','OVERCLOCKED']}}}))failure('ACTIVE_LEASE_EXISTS','conflict');
  if(await tx.rentalRequest.count({where:{userId,isTestOrder:false,leaseId:null,status:{in:['REQUESTED','REVIEWED']}}}))failure('ORDER_ALREADY_EXISTS','conflict');
  if(await tx.userLease.count({where:{userId,nodeId,status:{in:['PROVISIONING','ACTIVE','OVERCLOCKED']}}})>=catalog.maxPerUser)failure('USER_LIMIT','conflict');
  const balance=(await tx.ledgerEntry.aggregate({where:{userId},_sum:{amountMicros:true}}))._sum.amountMicros||0n;
  if(balance<principal)failure('INSUFFICIENT_BALANCE','conflict');
  const slot=await tx.gpuCatalog.updateMany({where:{id:nodeId,availableSupply:{gt:0}},data:{availableSupply:{decrement:1}}});
  if(slot.count!==1)failure('SOLD_OUT','conflict');
  const daily=principal*BigInt(baseRate)/10000n;
  const snapshot={nodeId,name:catalog.name,principalMicros:principal.toString(),baseDailyRateBps:baseRate,compoundDailyRateBps:compoundRate,
   contractDays:catalog.contractDays,compoundCycleDays:COMPOUND_CYCLE_DAYS,mode,offerVersion:offer.version,offerDocumentSha256:offer.sha256,
   earlyUnbondClause:'5.6 / 5.7',compoundLockClause:'5.8',contractReference:catalog.contractReference};
  const lease=await tx.userLease.create({data:{userId,nodeId,idempotencyKey,purchasePrice:catalog.priceUsdt,
   dailyYieldUsdt:fixed(daily/100n,4),contractReference:catalog.contractReference!,status:'PROVISIONING',expiresAt:null,
   offerVersion:offer.version,offerDocumentSha256:offer.sha256,mode,principalMicros:principal,baseDailyRateBps:baseRate,
   compoundDailyRateBps:compoundRate,contractDays:catalog.contractDays,compoundCycleDays:COMPOUND_CYCLE_DAYS,
   termsSnapshot:snapshot as Prisma.InputJsonValue}});
  await tx.rentalRequest.create({data:{userId,nodeId,leaseId:lease.id,idempotencyKey,profile:'MANAGED',workload:'Распределение задач выполняет оператор.',paymentStatus:'PAID'}});
  await tx.ledgerEntry.create({data:{userId,amountMicros:-principal,kind:'PURCHASE',sourceId:`lease:${lease.id}:purchase`}});
  await tx.audit.create({data:{actorId:userId,action:'EQUIPMENT_ORDER_CREATED',targetId:lease.id}});
  await notify(tx,{userId,type:'ORDER_CREATED',title:'Заказ оборудования создан',message:`${catalog.name} · ${mode} · ${microsToDecimal(principal)} USDT`,referenceType:'LEASE',referenceId:lease.id,dedupeKey:`lease:${lease.id}:order`});
  return presentLease(lease);
 },{timeout:30000});
}

export async function activate(db:PrismaClient,actorId:string,id:string,now=new Date()){
 flag('EPOCH_ACTIVATION',actorId);
 const peek=await db.userLease.findUnique({where:{id},select:{userId:true}});if(!peek)throw new NotFoundException('Заказ не найден.');
 return db.$transaction(async tx=>{
  await lockUser(tx,peek.userId);const row=await lockLease(tx,id);if(!row)throw new NotFoundException();
  if(row.status==='ACTIVE'||row.status==='COMPLETED')return presentLease(row);
  if(row.status!=='PROVISIONING')failure('LEASE_NOT_ACTIVE','conflict');
  const {principal,days}=requireSnapshot(row);
  if(row.mode==='COMPOUND')flag('COMPOUND',actorId);
  const epochEndsAt=new Date(now.getTime()+days*DAY_MS);
  const updated=await tx.userLease.update({where:{id},data:{status:'ACTIVE',activatedAt:now,epochEndsAt,expiresAt:epochEndsAt,
   lastYieldCalc:now,settledDays:0,accrualRemainder:0,compoundPrincipalMicros:principal,
   currentCompoundBlock:row.mode==='COMPOUND'?1:0,
   compoundBlockEndsAt:row.mode==='COMPOUND'?new Date(Math.min(now.getTime()+COMPOUND_CYCLE_DAYS*DAY_MS,epochEndsAt.getTime())):null}});
  await tx.rentalRequest.update({where:{leaseId:id},data:{status:'CLOSED',decision:'ACCEPTED',closureReason:'Оборудование активировано оператором.',closedAt:now,userUnread:true}});
  await tx.audit.create({data:{actorId,action:'EQUIPMENT_ACTIVATED',targetId:id}});
  await notify(tx,{userId:row.userId,type:'EQUIPMENT_ACTIVATED',title:'Оборудование активировано',message:`${row.nodeId} · ${row.mode} · ${days} дней · ${now.toISOString()}`,referenceType:'LEASE',referenceId:id,dedupeKey:`lease:${id}:activation`});
  return presentLease(updated);
 },{timeout:30000});
}

export async function rejectProvisioning(db:PrismaClient,actorId:string,id:string,reason:string,now=new Date()){
 if(typeof reason!=='string'||reason.trim().length<3||reason.length>1000)throw new BadRequestException('Укажите причину отказа.');
 const peek=await db.userLease.findUnique({where:{id},select:{userId:true}});if(!peek)throw new NotFoundException('Заказ не найден.');
 return db.$transaction(async tx=>{
  await lockUser(tx,peek.userId);const row=await lockLease(tx,id);if(!row)throw new NotFoundException();
  if(row.status==='CANCELLED')return presentLease(row);
  if(row.status!=='PROVISIONING')failure('LEASE_NOT_ACTIVE','conflict');
  const {principal}=requireSnapshot(row);
  await restoreSupply(tx,row,now);
  const updated=await tx.userLease.update({where:{id},data:{status:'CANCELLED'}});
  await tx.ledgerEntry.create({data:{userId:row.userId,kind:'PURCHASE_REFUND',amountMicros:principal,sourceId:`lease:${id}:purchase-refund`}});
  await tx.rentalRequest.update({where:{leaseId:id},data:{status:'CLOSED',decision:'REJECTED',closureReason:reason.trim(),closedAt:now,userUnread:true}});
  await tx.audit.create({data:{actorId,action:'EQUIPMENT_ORDER_REJECTED',targetId:id}});
  await notify(tx,{userId:row.userId,type:'ORDER_REJECTED',title:'Заказ отклонён, депозит возвращён',message:reason.trim(),referenceType:'LEASE',referenceId:id,dedupeKey:`lease:${id}:rejected`});
  return presentLease(updated);
 },{timeout:30000});
}

async function settleInTransaction(tx:Tx,row:UserLease,now:Date){
 if(row.status!=='ACTIVE')return row;
 const {principal,rate,days}=requireSnapshot(row);
 if(!row.activatedAt||!row.epochEndsAt||row.epochEndsAt.getTime()!==row.activatedAt.getTime()+days*DAY_MS)failure('INVALID_LEASE_TERMS','conflict');
 let settledDays=row.settledDays,remainder=row.accrualRemainder,baseAccrued=row.baseAccruedMicros,
  capital=row.compoundPrincipalMicros||principal,profit=row.compoundProfitMicros;
 const target=Math.min(days,completedIntervals(row.activatedAt!,row.epochEndsAt!,now));
 for(let day=settledDays+1;day<=target;day++){
  const opening=row.mode==='BASE'?principal:capital;
  const amount=accrueDay(opening,rate,remainder);remainder=amount.remainder;
  const block=row.mode==='COMPOUND'?Math.ceil(day/COMPOUND_CYCLE_DAYS):0;
  await tx.leaseAccrual.create({data:{leaseId:row.id,dayIndex:day,mode:row.mode!,openingPrincipalMicros:opening,rateBps:rate,
   yieldMicros:amount.yieldMicros,closingPrincipalMicros:opening+(row.mode==='COMPOUND'?amount.yieldMicros:0n),compoundBlock:block}});
  if(row.mode==='BASE'){
   await tx.ledgerEntry.create({data:{userId:row.userId,kind:'EPOCH_YIELD',amountMicros:amount.yieldMicros,sourceId:`lease:${row.id}:yield:${day}`}});
   baseAccrued+=amount.yieldMicros;
  }else{capital+=amount.yieldMicros;profit+=amount.yieldMicros;}
  settledDays=day;
 }
 const completed=now>=row.epochEndsAt!&&settledDays===days;
 const block=row.mode==='COMPOUND'&&!completed?Math.min(Math.floor(settledDays/COMPOUND_CYCLE_DAYS)+1,Math.ceil(days/COMPOUND_CYCLE_DAYS)):row.currentCompoundBlock;
 const blockEnd=row.mode==='COMPOUND'&&!completed?new Date(Math.min(row.activatedAt!.getTime()+block*COMPOUND_CYCLE_DAYS*DAY_MS,row.epochEndsAt!.getTime())):row.compoundBlockEndsAt;
 if(completed){
  await tx.ledgerEntry.create({data:{userId:row.userId,kind:'LEASE_PRINCIPAL_RELEASE',amountMicros:principal,sourceId:`lease:${row.id}:principal-release`}});
  if(row.mode==='COMPOUND'&&profit>0n)await tx.ledgerEntry.create({data:{userId:row.userId,kind:'EPOCH_COMPOUND_YIELD',amountMicros:profit,sourceId:`lease:${row.id}:compound-profit`}});
  await restoreSupply(tx,row,now);
  await tx.audit.create({data:{actorId:'SYSTEM',action:'EPOCH_COMPLETED',targetId:row.id}});
  await notify(tx,{userId:row.userId,type:'EPOCH_COMPLETED',title:'Epoch завершён',message:`${row.nodeId} · ${microsToDecimal(principal)} USDT возвращено`,referenceType:'LEASE',referenceId:row.id,dedupeKey:`lease:${row.id}:completed`});
 }
 return tx.userLease.update({where:{id:row.id},data:{settledDays,accrualRemainder:remainder,baseAccruedMicros:baseAccrued,
  compoundPrincipalMicros:capital,compoundProfitMicros:profit,currentCompoundBlock:block,compoundBlockEndsAt:blockEnd,
  lastYieldCalc:new Date(row.activatedAt!.getTime()+settledDays*DAY_MS),
  ...(completed?{status:'COMPLETED',completedAt:row.epochEndsAt}:{} )}});
}

export async function settleLease(db:PrismaClient,id:string,now=new Date()){
 flag('ACCRUAL');
 const peek=await db.userLease.findUnique({where:{id},select:{userId:true}});if(!peek)throw new NotFoundException();
 return db.$transaction(async tx=>{
  await lockUser(tx,peek.userId);const row=await lockLease(tx,id);if(!row)throw new NotFoundException();
  if(!row.offerVersion)return presentLease(row);
  return presentLease(await settleInTransaction(tx,row,now));
 },{timeout:30000});
}

export async function quoteUnbond(db:PrismaClient,userId:string,id:string,now=new Date()){
 const row=await db.userLease.findFirst({where:{id,userId}});if(!row)throw new NotFoundException('Нода не найдена.');
 if(row.status!=='ACTIVE')failure('LEASE_NOT_ACTIVE','conflict');
 const {principal,days}=requireSnapshot(row);
 if(!row.activatedAt||!row.epochEndsAt)failure('LEASE_NOT_ACTIVE','conflict');
 const result=calculateEarlyUnbondingFee({activatedAt:row.activatedAt!,epochEndsAt:row.epochEndsAt!,contractDays:days,principalMicros:principal,compoundEnabled:row.mode==='COMPOUND',now});
 return {leaseId:id,allowed:result.allowed&&financialFlag('EARLY_UNBONDING')&&financialFlag('ACCRUAL')&&financialAccess(userId),
  principal:microsToDecimal(principal),cycleDay:result.cycleDay,feePercent:fixed(BigInt(result.feeBps),2),
  fee:microsToDecimal(result.feeMicros),netPrincipal:microsToDecimal(result.netPrincipalMicros),epochEndsAt:row.epochEndsAt,
  mode:row.mode,reason:result.reason||(!financialFlag('EARLY_UNBONDING')?'EARLY_UNBONDING_DISABLED':!financialFlag('ACCRUAL')?'ACCRUAL_PAUSED':null),clause:result.clause};
}

export async function unbond(db:PrismaClient,userId:string,id:string,input:Record<string,unknown>,now=new Date()){
 flag('EARLY_UNBONDING',userId);flag('ACCRUAL');key(input.idempotencyKey);
 const peek=await db.userLease.findFirst({where:{id,userId},select:{id:true}});if(!peek)throw new NotFoundException('Нода не найдена.');
 return db.$transaction(async tx=>{
  await lockUser(tx,userId);const row=await lockLease(tx,id);if(!row||row.userId!==userId)throw new NotFoundException();
  if(row.status==='EARLY_UNBONDED')return presentLease(row);
  if(row.status!=='ACTIVE')failure('LEASE_NOT_ACTIVE','conflict');
  const {principal,days}=requireSnapshot(row);
  if(!row.activatedAt||!row.epochEndsAt)failure('LEASE_NOT_ACTIVE','conflict');
  const quote=calculateEarlyUnbondingFee({activatedAt:row.activatedAt!,epochEndsAt:row.epochEndsAt!,contractDays:days,principalMicros:principal,compoundEnabled:row.mode==='COMPOUND',now});
  if(quote.reason==='EPOCH_COMPLETED')return presentLease(await settleInTransaction(tx,row,now));
  if(!quote.allowed)failure(quote.reason||'LEASE_NOT_ACTIVE','conflict');
  const settled=await settleInTransaction(tx,row,now);
  await restoreSupply(tx,settled,now);
  const updated=await tx.userLease.update({where:{id},data:{status:'EARLY_UNBONDED',earlyUnbondedAt:now,unbondFeeMicros:quote.feeMicros}});
  await tx.ledgerEntry.create({data:{userId,kind:'LEASE_PRINCIPAL_RELEASE',amountMicros:principal,sourceId:`lease:${id}:principal-release`}});
  await tx.ledgerEntry.create({data:{userId,kind:'EARLY_UNBONDING_FEE',amountMicros:-quote.feeMicros,sourceId:`lease:${id}:unbond-fee`}});
  await tx.audit.create({data:{actorId:userId,action:'EARLY_UNBOND',targetId:id}});
  await notify(tx,{userId,type:'EARLY_UNBOND_COMPLETED',title:'Epoch завершён досрочно',message:`Возвращено ${microsToDecimal(quote.netPrincipalMicros)} USDT; комиссия ${microsToDecimal(quote.feeMicros)} USDT`,referenceType:'LEASE',referenceId:id,dedupeKey:`lease:${id}:unbond`});
  return presentLease(updated);
 },{timeout:30000});
}
