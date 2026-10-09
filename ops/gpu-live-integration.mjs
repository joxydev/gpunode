// Real HTTP + Prisma, exclusively on the disposable VPS CI PostgreSQL database.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createDb} from '../backend/dist/db-utc.js';
import {signSession} from '../backend/dist/security.js';
import {activate,settleLease} from '../backend/dist/financial-cycle.js';
import {projectAccrual} from '../backend/dist/live-accrual.js';
import {OFFER_VERSION,OFFER_DOCUMENT_SHA256} from '../backend/dist/offer.js';
if(process.env.CI_INTEGRATION!=='1'||new URL(process.env.DATABASE_URL).pathname!=='/aethermind_ci')throw Error('GPU live suite requires disposable CI database');
Object.assign(process.env,JSON.parse(readFileSync(new URL('./public-runtime-flags.json',import.meta.url),'utf8')));
const db=createDb(process.env.DATABASE_URL,3),port=process.env.CI_PORT||'3100',base=`http://127.0.0.1:${port}/api`;
const child=spawn(process.execPath,['backend/dist/main.js'],{env:{...process.env,PORT:port,TONCENTER_API_KEY:'CI_NOT_A_REAL_TON_KEY'},stdio:['ignore','inherit','inherit']});
const stopped=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)});
async function call(path,user,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(user?{Authorization:'Bearer '+signSession(user,process.env.SESSION_SECRET)}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});return {status:response.status,data:await response.json()};}
try{
 let ready=false;for(let i=0;i<60;i++){try{if((await call('/health')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready);
 const owner=process.env.OWNER_TELEGRAM_ID;
 for(const [index,nodeId,principal,first,second] of [[0,'NODE_4090',50,'900000','916200'],[1,'NODE_A100',300,'9000000','9270000'],[2,'NODE_H100',1200,'50400000','52516800']]){
  const id=String(920000+index);assert.ok(id!==owner&&!process.env.FINANCIAL_CANARY_IDS.split(',').includes(id),'ordinary non-canary participant');
  await db.user.create({data:{id,name:'GPU live CI '+id,agreementVersion:'2026-09-14',agreementAcceptedAt:new Date()}});
  await db.offerAcceptance.create({data:{userId:id,version:OFFER_VERSION,documentSha256:OFFER_DOCUMENT_SHA256,acceptedAt:new Date(),clientHash:'a'.repeat(64)}});
  await db.ledgerEntry.create({data:{userId:id,kind:'CI_FIXTURE_ONLY',amountMicros:BigInt(principal)*1000000n,sourceId:'gpu-live-ci:'+id}});
  await db.gpuCatalog.update({where:{id:nodeId},data:{supplyKnown:true,totalSupply:200,availableSupply:150,contractReference:{NODE_4090:'REF-ALPHA-2026-01',NODE_A100:'REF-BETA-2026-02',NODE_H100:'REF-ENT-2026-03'}[nodeId]}});
  const profile=await call('/me',id);assert.equal(profile.status,200);assert.equal(profile.data.compoundEnabled,true);assert.ok(Date.parse(profile.data.serverNow));
  const order={nodeId,compoundEnabled:true,idempotencyKey:randomUUID()};
  const bought=await call('/v1/market/buy',id,order);assert.equal(bought.status,201,JSON.stringify(bought.data));assert.equal(bought.data.mode,'COMPOUND');assert.equal(bought.data.liveAccrual.state,'PROVISIONING');
  assert.equal((await call('/v1/market/buy',id,order)).data.id,bought.data.id);
  assert.equal((await call('/v1/market/buy',id,{...order,compoundEnabled:false})).status,409);
  assert.equal((await call(`/v1/admin/leases/${bought.data.id}/activate`,id,{})).status,403);
  const at=new Date(Date.now()-2*86400000-11000);await activate(db,owner,bought.data.id,at);
  const initial=await db.userLease.findUniqueOrThrow({where:{id:bought.data.id}}),ledgerBefore=await db.ledgerEntry.count({where:{userId:id}});
  assert.equal(projectAccrual(initial,at,true).dailyYieldMicros,first);
  assert.equal(projectAccrual(initial,new Date(+at+86400000+1000),true).dailyYieldMicros,second);
  const detail=await call(`/v1/market/leases/${bought.data.id}`,id);assert.equal(detail.status,200);assert.equal(detail.data.liveAccrual.pendingDays,2);
  // An existing ordinary CI identity from earlier suites cannot read another user's lease.
  assert.equal((await call(`/v1/market/leases/${bought.data.id}`,'22222')).status,404);
  assert.equal(await db.ledgerEntry.count({where:{userId:id}}),ledgerBefore,'GET does not write money');
  const now=new Date(+at+2*86400000+20000),before=projectAccrual(initial,now,true);
  await settleLease(db,bought.data.id,now);await settleLease(db,bought.data.id,now);
  const settled=await db.userLease.findUniqueOrThrow({where:{id:bought.data.id}}),after=projectAccrual(settled,now,true);
  assert.equal(BigInt(before.confirmedProfitMicros)+BigInt(before.pendingProfitMicros),BigInt(after.confirmedProfitMicros)+BigInt(after.pendingProfitMicros));
  assert.equal(before.dailyYieldMicros,after.dailyYieldMicros);assert.equal(await db.leaseAccrual.count({where:{leaseId:bought.data.id}}),2);
  const end=settled.epochEndsAt;await settleLease(db,bought.data.id,end);await settleLease(db,bought.data.id,end);
  assert.equal((await db.userLease.findUniqueOrThrow({where:{id:bought.data.id}})).status,'COMPLETED');
  assert.equal(await db.ledgerEntry.count({where:{userId:id,kind:'EPOCH_COMPOUND_YIELD'}}),1);
 }
 assert.equal((await call('/offer')).data.compoundEnabled,true);
 console.log('GPU LIVE CI PASSED: ordinary public Compound for 3 tariffs, read-only projection, catch-up, foreign lease isolation and idempotent settlement.');
}finally{
 await db.$disconnect();if(child.exitCode===null)child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
 try{await stopped}finally{clearTimeout(timer)}
}
