// Real Nest + Prisma + isolated PostgreSQL; synthetic time and money stay in aethermind_ci.
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createDb} from '../backend/dist/db-utc.js';
import {activate,settleLease,unbond} from '../backend/dist/financial-cycle.js';

if(process.env.CI_INTEGRATION!=='1'||new URL(process.env.DATABASE_URL).pathname!=='/aethermind_ci'||
 process.env.FINANCIAL_PUBLIC_ACCESS!=='false')throw Error('Financial fixture requires isolated PostgreSQL and private canary');
const port=process.env.CI_PORT||'3100',base=`http://127.0.0.1:${port}/api`;
const child=spawn(process.execPath,['backend/dist/main.js'],{stdio:['ignore','inherit','inherit'],env:{...process.env,PORT:port}});
const db=createDb(process.env.DATABASE_URL,5),DAY=86400000;
async function call(path,token,body,method=body?'POST':'GET'){
 const response=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 return {status:response.status,data:await response.json()};
}
async function login(id){
 const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'CI '+id})});
 const key=createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();
 p.set('hash',createHmac('sha256',key).update([...p.entries()].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));
 const r=await call('/auth/telegram',null,{initData:p.toString()});assert.equal(r.status,201);return r.data.token;
}
async function setup(id,credit){
 const token=await login(id);
 assert.equal((await call('/agreement/accept',token,{version:'2026-09-14'})).status,201);
 const offer=await call('/v1/financial-offer',token);assert.equal(offer.status,200);assert.equal(offer.data.available,true);
 assert.equal((await call('/v1/financial-offer/accept',token,{version:offer.data.version,documentSha256:offer.data.sha256,readConfirmed:true})).status,201);
 await db.ledgerEntry.create({data:{userId:String(id),kind:'CI_FIXTURE_ONLY',amountMicros:BigInt(credit)*1000000n,sourceId:'financial-ci:'+id}});
 return token;
}
async function rows(leaseId){return db.ledgerEntry.findMany({where:{sourceId:{startsWith:`lease:${leaseId}:`}}});}
async function balance(userId){return (await db.ledgerEntry.aggregate({where:{userId:String(userId)},_sum:{amountMicros:true}}))._sum.amountMicros||0n;}
try{
 let healthy=false;for(let i=0;i<50;i++){try{if((await call('/health')).status===200){healthy=true;break}}catch{}await new Promise(r=>setTimeout(r,200))}assert.ok(healthy);
 await db.gpuCatalog.updateMany({where:{id:{in:['NODE_4090','NODE_A100','NODE_H100']}},data:{supplyKnown:true,totalSupply:4,availableSupply:4,contractReference:'CI-ONLY-SYNTHETIC-STOCK'}});
 const owner=await login(11111),alpha=await setup(55555,50);
 assert.equal((await call('/agreement/accept',owner,{version:'2026-09-14'})).status,201);
 const unfunded=await login(99999);await call('/agreement/accept',unfunded,{version:'2026-09-14'});
 assert.equal((await call('/v1/market/buy',unfunded,{nodeId:'NODE_4090',compoundEnabled:false,idempotencyKey:randomUUID()})).status,403,'new offer required');
 const purchaseBody={nodeId:'NODE_4090',compoundEnabled:false,idempotencyKey:randomUUID()};
 const attempts=await Promise.all(Array.from({length:10},()=>call('/v1/market/buy',alpha,purchaseBody)));
 assert.ok(attempts.every(r=>r.status===201));
 const leaseId=attempts[0].data.id;assert.ok(attempts.every(r=>r.data.id===leaseId));
 assert.equal(attempts[0].data.status,'PROVISIONING');assert.equal(attempts[0].data.activatedAt,null);
 assert.equal((await rows(leaseId)).filter(r=>r.kind==='PURCHASE').length,1);
 assert.equal((await db.rentalRequest.count({where:{leaseId,paymentStatus:'PAID'}})),1);
 assert.equal(await balance(55555),0n);
 assert.equal((await call(`/v1/leases/${leaseId}/unbond/quote`,unfunded)).status,404);
 assert.equal((await call(`/v1/admin/leases/${leaseId}/activate`,alpha,{})).status,403);
 assert.equal((await call('/v1/market/buy',alpha,{...purchaseBody,idempotencyKey:randomUUID()})).status,409);
 const activations=await Promise.all(Array.from({length:2},()=>call(`/v1/admin/leases/${leaseId}/activate`,owner,{})));
 assert.ok(activations.every(r=>r.status===201));
 const active=await db.userLease.findUniqueOrThrow({where:{id:leaseId}});assert.equal(active.status,'ACTIVE');
 const at=active.activatedAt.getTime();
 await Promise.all(Array.from({length:10},()=>settleLease(db,leaseId,new Date(at+2*DAY))));
 assert.equal((await db.leaseAccrual.count({where:{leaseId}})),2);
 assert.equal((await rows(leaseId)).filter(r=>r.kind==='EPOCH_YIELD').length,2);
 assert.equal(await balance(55555),1500000n);
 const withdrawal=await call('/v1/withdrawals',alpha,{asset:'USDT',network:'TON',destinationAddress:'UQBHmBs516S1EKkDLj9K-hwCD-WlvRn05ieMiScK-pBBO8iH',amount:'0.750000',idempotencyKey:randomUUID()});
 assert.equal(withdrawal.status,201);assert.equal(withdrawal.data.platformFee,'0.000000');assert.equal(withdrawal.data.networkFee,null);
 assert.equal((await call(`/v1/withdrawals/${withdrawal.data.id}/cancel`,alpha,{})).status,201);
 const q=await call(`/v1/leases/${leaseId}/unbond/quote`,alpha);assert.equal(q.data.fee,'7.500000');
 const unbonds=await Promise.all(Array.from({length:2},()=>call(`/v1/leases/${leaseId}/unbond`,alpha,{idempotencyKey:randomUUID()})));
 assert.ok(unbonds.every(r=>r.status===201));
 assert.equal((await rows(leaseId)).filter(r=>r.kind==='EARLY_UNBONDING_FEE').length,1);
 assert.equal((await rows(leaseId)).filter(r=>r.kind==='LEASE_PRINCIPAL_RELEASE').length,1);
 assert.equal(await balance(55555),44000000n,'Base income remains available after fee');
 assert.equal((await db.gpuCatalog.findUniqueOrThrow({where:{id:'NODE_4090'}})).availableSupply,4);

 const beta=await setup(66666,300);
 const pending=await call('/v1/market/buy',beta,{nodeId:'NODE_A100',compoundEnabled:false,idempotencyKey:randomUUID()});assert.equal(pending.status,201);
 const denied=await Promise.all(Array.from({length:2},()=>call(`/v1/admin/leases/${pending.data.id}/reject`,owner,{reason:'CI provisioning rejection'})));
 assert.ok(denied.every(r=>r.status===201));assert.equal(await balance(66666),300000000n);
 assert.equal((await rows(pending.data.id)).filter(r=>r.kind==='PURCHASE_REFUND').length,1);
 assert.equal((await db.gpuCatalog.findUniqueOrThrow({where:{id:'NODE_A100'}})).availableSupply,4);

 const betaBase=await call('/v1/market/buy',beta,{nodeId:'NODE_A100',compoundEnabled:false,idempotencyKey:randomUUID()});assert.equal(betaBase.status,201);
 await call(`/v1/admin/leases/${betaBase.data.id}/activate`,owner,{});
 const betaStart=(await db.userLease.findUniqueOrThrow({where:{id:betaBase.data.id}})).activatedAt.getTime();
 const fee=await unbond(db,'66666',betaBase.data.id,{idempotencyKey:randomUUID()},new Date(betaStart+44*DAY));
 assert.equal(fee.unbondFee,'9.000000');assert.equal(fee.settledDays,44);
 assert.equal(await balance(66666),621000000n,'300 principal - 9 fee + 44 * 7.5 yield');

 const compoundUser=await setup(77777,300);
 const compound=await call('/v1/market/buy',compoundUser,{nodeId:'NODE_A100',compoundEnabled:true,idempotencyKey:randomUUID()});assert.equal(compound.status,201);
 await call(`/v1/admin/leases/${compound.data.id}/activate`,owner,{});
 const compoundStart=(await db.userLease.findUniqueOrThrow({where:{id:compound.data.id}})).activatedAt.getTime();
 assert.equal((await call(`/v1/leases/${compound.data.id}/unbond/quote`,compoundUser)).data.reason,'COMPOUND_LOCKED');
 await settleLease(db,compound.data.id,new Date(compoundStart+31*DAY));
 const rolled=await db.userLease.findUniqueOrThrow({where:{id:compound.data.id}});
 assert.equal(rolled.currentCompoundBlock,2);assert.equal(rolled.settledDays,31);
 assert.equal(await balance(77777),0n,'compound profit must not be available mid Epoch');
 assert.equal((await rows(compound.data.id)).filter(r=>r.kind==='EPOCH_YIELD').length,0);
 await Promise.all(Array.from({length:3},()=>settleLease(db,compound.data.id,new Date(compoundStart+60*DAY))));
 const final=await db.userLease.findUniqueOrThrow({where:{id:compound.data.id}});assert.equal(final.status,'COMPLETED');assert.equal(final.settledDays,60);
 assert.equal((await rows(compound.data.id)).filter(r=>r.kind==='LEASE_PRINCIPAL_RELEASE').length,1);
 assert.equal((await rows(compound.data.id)).filter(r=>r.kind==='EPOCH_COMPOUND_YIELD').length,1);
 assert.equal(await balance(77777),final.compoundPrincipalMicros);
 assert.equal((await call(`/v1/leases/${compound.data.id}/unbond/quote`,compoundUser)).status,409);

 const enterprise=await setup(88888,1200);
 const pod=await call('/v1/market/buy',enterprise,{nodeId:'NODE_H100',compoundEnabled:true,idempotencyKey:randomUUID()});assert.equal(pod.status,201);
 await call(`/v1/admin/leases/${pod.data.id}/activate`,owner,{});
 const podStart=(await db.userLease.findUniqueOrThrow({where:{id:pod.data.id}})).activatedAt.getTime();
 await settleLease(db,pod.data.id,new Date(podStart+60*DAY));
 assert.equal((await db.userLease.findUniqueOrThrow({where:{id:pod.data.id}})).currentCompoundBlock,3);
 await settleLease(db,pod.data.id,new Date(podStart+90*DAY));
 assert.equal((await db.leaseAccrual.count({where:{leaseId:pod.data.id}})),90);
 assert.equal((await rows(pod.data.id)).filter(r=>r.kind==='EPOCH_COMPOUND_YIELD').length,1);

 const unauthorized=await call('/v1/admin/leases',alpha);assert.equal(unauthorized.status,403);
 assert.equal((await call('/v1/activity',alpha)).data.items.filter(row=>row.type==='PURCHASE').length,1);
 assert.equal((await call('/v1/notifications',alpha)).data.items.filter(row=>row.type==='ORDER_CREATED').length,1);
 console.log('FINANCIAL CI PASSED: purchase, owner actions, Base, Compound 30/60/90, unbond and ledger isolation.');
}finally{
 await db.$disconnect();child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));
}
