// Real PostgreSQL/Nest integration. This executable refuses a production database.
import {spawn} from 'node:child_process';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createDb} from '../backend/dist/db-utc.js';import {signSession} from '../backend/dist/security.js';import {Address} from '@ton/ton';
if(process.env.CI_INTEGRATION!=='1'||new URL(process.env.DATABASE_URL).pathname!=='/aethermind_ci')throw Error('Admin credit tests require isolated CI PostgreSQL');
const port=process.env.CI_PORT||'3100',base=`http://127.0.0.1:${port}/api`,db=createDb(process.env.DATABASE_URL,6);
const ownerId=process.env.OWNER_TELEGRAM_ID,owner=signSession(ownerId,process.env.SESSION_SECRET);
const child=spawn(process.execPath,['backend/dist/main.js'],{stdio:['ignore','inherit','inherit'],env:{...process.env,PORT:port}}),stopped=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)});
const token=id=>signSession(id,process.env.SESSION_SECRET),creditPath=id=>'/admin/users/'+id+'/balance/credits';
async function call(path,auth,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(auth?{Authorization:'Bearer '+auth}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
const amount=async id=>(await db.ledgerEntry.aggregate({where:{userId:id},_sum:{amountMicros:true}}))._sum.amountMicros||0n;
const payload=(value='12.345678',reason='CI administrative reason')=>({amount:value,reason,idempotencyKey:randomUUID()});
try{
 let ready=false;for(let i=0;i<60;i++){try{if((await call('/health')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,200))}assert.ok(ready);
 for(const id of [ownerId,'910001','910002','910003','910004','910005','910006'])await db.user.upsert({where:{id},create:{id,name:'Credit CI '+id,agreementVersion:'2026-09-14',agreementAcceptedAt:new Date()},update:{agreementVersion:'2026-09-14',agreementAcceptedAt:new Date()}});
 const beforeCounts=await db.adminBalanceCredit.count();
 assert.equal((await call(creditPath('bad'),null,{amount:'NaN'})).status,401);
 assert.equal((await call(creditPath('bad'),token('910001'),{amount:'NaN',actorId:ownerId})).status,403);
 assert.equal((await call(creditPath('910001'),token('910001'))).status,403);
 assert.equal((await call(creditPath('999991'),owner,payload())).status,404);
 for(const value of ['0','-1','NaN','1e2','1.0000001','9223372036854.775808',10])assert.equal((await call(creditPath('910001'),owner,payload(value))).status,400);
 assert.equal((await call(creditPath('910001'),owner,{...payload(),actorId:'910002'})).status,400);
 assert.equal(await db.adminBalanceCredit.count(),beforeCounts);
 const body=payload(),first=await call(creditPath('910001'),owner,body);assert.equal(first.status,201);assert.equal(first.data.amount,'12.345678');assert.equal(await amount('910001'),12345678n);
 const normalized=await call(creditPath('910001'),owner,{...body,amount:'12,345678',reason:'  CI  administrative\nreason '});assert.equal(normalized.status,201);assert.equal(normalized.data.id,first.data.id);
 for(const changed of [{...body,amount:'13'},{...body,reason:'Different reason'}])assert.equal((await call(creditPath('910001'),owner,changed)).status,409);
 assert.equal((await call(creditPath('910002'),owner,body)).status,409);
 const concurrent=payload('2.000001'),repeats=await Promise.all(Array.from({length:10},()=>call(creditPath('910001'),owner,concurrent)));assert.ok(repeats.every(r=>r.status===201));assert.equal(new Set(repeats.map(r=>r.data.id)).size,1);
 const cross=payload('3');const conflicting=await Promise.all([call(creditPath('910002'),owner,cross),call(creditPath('910003'),owner,cross)]);assert.deepEqual(conflicting.map(r=>r.status).sort(),[201,409]);assert.equal(await amount('910002')+await amount('910003'),3000000n);
 const independent=await Promise.all(Array.from({length:8},()=>call(creditPath('910001'),owner,payload('0.000001'))));assert.ok(independent.every(r=>r.status===201));assert.equal(await amount('910001'),14345687n);
 const ownBefore=await amount(ownerId);assert.equal((await call(creditPath(ownerId),owner,payload('0.000001'))).status,201);assert.equal(await amount(ownerId),ownBefore+1n);
 await db.ledgerEntry.create({data:{userId:'910004',amountMicros:9223372036854775807n,kind:'CI_FIXTURE_ONLY',sourceId:'credit-ci-max'}});
 assert.equal((await call(creditPath('910004'),owner,payload('0.000001'))).status,400);
 // Force an audit failure AFTER ledger/model insertion and verify the entire transaction rolls back.
 await db.$executeRawUnsafe(`CREATE FUNCTION ci_credit_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ADMIN_BALANCE_CREDIT' AND EXISTS(SELECT 1 FROM "AdminBalanceCredit" WHERE id::text=NEW."targetId" AND "userId"='910005') THEN RAISE EXCEPTION 'CI deliberate audit failure'; END IF; RETURN NEW; END $$`);
 await db.$executeRawUnsafe(`CREATE TRIGGER ci_credit_audit_fail BEFORE INSERT ON "Audit" FOR EACH ROW EXECUTE FUNCTION ci_credit_audit_fail()`);
 const failing=payload('1'),failed=await call(creditPath('910005'),owner,failing);assert.equal(failed.status,500);assert.equal(await amount('910005'),0n);assert.equal(await db.adminBalanceCredit.count({where:{userId:'910005'}}),0);assert.equal(await db.notification.count({where:{userId:'910005',type:'ADMIN_CREDIT'}}),0);
 await db.$executeRawUnsafe('DROP TRIGGER ci_credit_audit_fail ON "Audit"');await db.$executeRawUnsafe('DROP FUNCTION ci_credit_audit_fail()');assert.equal((await call(creditPath('910005'),owner,failing)).status,201);
 for(const row of await db.adminBalanceCredit.findMany()){
  assert.equal(await db.ledgerEntry.count({where:{id:row.ledgerId,userId:row.userId,kind:'ADMIN_CREDIT',sourceId:'admin-credit:'+row.id,amountMicros:row.amountMicros}}),1);
  assert.equal(await db.audit.count({where:{actorId:ownerId,action:'ADMIN_BALANCE_CREDIT',targetId:row.id}}),1);
  const notices=await db.notification.findMany({where:{dedupeKey:'admin-credit:'+row.id}});assert.equal(notices.length,1);assert.ok(!notices[0].message.includes(row.reason));
 }
 const activities=(await call('/v1/activity?type=ADJUSTMENT',token('910001'))).data.items;assert.ok(activities.some(r=>r.type==='ADMIN_CREDIT'&&r.amount==='12.345678'&&r.network===null));
 assert.equal((await call('/admin/users/910001',owner)).data.statistics.deposited,'0.000000');assert.equal(await db.tonDeposit.count({where:{userId:'910001'}}),0);assert.equal(await db.walletLedger.count({where:{userId:'910001'}}),0);
 // Ordinary withdrawal and credit share the recipient lock: no lost update or overspending.
 await call(creditPath('910006'),owner,payload('20'));const address=Address.parseRaw('0:'+ '1'.repeat(64)).toString({bounceable:false,urlSafe:true});
 const mixed=await Promise.all([call(creditPath('910006'),owner,payload('5')),call('/v1/withdrawals',token('910006'),{asset:'USDT',network:'TON',amount:'10',destinationAddress:address,idempotencyKey:randomUUID()})]);assert.ok(mixed.every(r=>r.status===201));assert.equal(await amount('910006'),15000000n);
 // Normal order spends the credited ordinary balance, preserving offer/stock checks.
 const offer=(await call('/v1/financial-offer',token('910005'))).data;
 await call('/v1/financial-offer/accept',token('910005'),{version:offer.version,documentSha256:offer.sha256,readConfirmed:true});
 await db.gpuCatalog.update({where:{id:'NODE_4090'},data:{supplyKnown:true,totalSupply:20,availableSupply:20}});await call(creditPath('910005'),owner,payload('49'));
 // This CI user is an explicit canary; do not modify the public runtime helper flags.
 const order={nodeId:'NODE_4090',compoundEnabled:false,idempotencyKey:randomUUID()};const simultaneous=await Promise.all([call(creditPath('910005'),owner,payload('2')),call('/v1/market/buy',token('910005'),order)]);assert.ok(simultaneous.every(r=>r.status===201));assert.equal(await amount('910005'),2000000n);assert.equal((await call('/v1/market/buy',token('910005'),order)).data.id,simultaneous[1].data.id);assert.equal(await amount('910005'),2000000n);
 console.log('ADMIN CREDIT CI PASSED: auth, exact amounts, self credit, parallel retries, cross-recipient conflict, rollback, overflow, notification/activity isolation, withdrawal and purchase.');
}finally{
 if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')},5000);try{await stopped}finally{clearTimeout(timer);await db.$disconnect()}
}
