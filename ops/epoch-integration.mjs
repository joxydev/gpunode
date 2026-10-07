// Real Prisma worker checks on the disposable PostgreSQL used by CI only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {createDb} from '../backend/dist/db-utc.js';
import {runEpochSettlement} from '../backend/dist/epoch-settle.js';
import {OFFER_VERSION,OFFER_DOCUMENT_SHA256,offerTariffs} from '../backend/dist/offer.js';

const url=process.env.DATABASE_URL;
if(process.env.CI_INTEGRATION!=='1'||!url||new URL(url).pathname!=='/aethermind_ci')throw Error('Epoch fixture requires isolated aethermind_ci');
const db=createDb(url,3),DAY=86400000;
try{
 assert.equal(await db.userLease.count({where:{status:'ACTIVE',offerVersion:{not:null}}}),0,'prior fixture must leave no active modern leases');
 assert.deepEqual(await runEpochSettlement(url),{paused:false,processed:0},'empty table must accept the first UUID page');
 const cli=spawnSync(process.execPath,['dist/epoch-settle.js'],{cwd:fileURLToPath(new URL('../backend/',import.meta.url)),env:process.env,encoding:'utf8',timeout:30000});
 assert.equal(cli.status,0,cli.stderr);
 assert.deepEqual(JSON.parse(cli.stdout.trim().split('\n').at(-1)),{paused:false,processed:0},'actual systemd entrypoint must run, not silently skip');

 const lock=new Client({connectionString:url});await lock.connect();
 try{
  await lock.query('SELECT pg_advisory_lock($1)',[2026092901]);
  assert.deepEqual(await runEpochSettlement(url),{paused:false,locked:true,processed:0},'another worker must not settle concurrently');
 }finally{await lock.query('SELECT pg_advisory_unlock($1)',[2026092901]);await lock.end()}

 const started=new Date('2025-01-01T12:00:00.000Z'),now=new Date(started.getTime()+DAY);
 const tariff=offerTariffs.find(row=>row.nodeId==='NODE_4090');
 await db.gpuCatalog.update({where:{id:tariff.nodeId},data:{totalSupply:105,availableSupply:4}});
 const users=Array.from({length:101},(_,index)=>({id:String(800000+index),name:'Epoch CI '+index}));
 await db.user.createMany({data:users});
 const leases=users.map(user=>({id:randomUUID(),userId:user.id,nodeId:tariff.nodeId,idempotencyKey:randomUUID(),status:'ACTIVE',
  purchasePrice:50,dailyYieldUsdt:'0.7500',contractReference:tariff.contractReference,
  offerVersion:OFFER_VERSION,offerDocumentSha256:OFFER_DOCUMENT_SHA256,mode:'BASE',principalMicros:50000000n,
  baseDailyRateBps:150,compoundDailyRateBps:180,contractDays:30,compoundCycleDays:30,termsSnapshot:{ciOnly:true},
  createdAt:started,lastYieldCalc:started,activatedAt:started,epochEndsAt:new Date(started.getTime()+30*DAY),expiresAt:new Date(started.getTime()+30*DAY)}));
 await db.userLease.createMany({data:leases});
 assert.deepEqual(await runEpochSettlement(url,now),{paused:false,processed:101},'must settle across the 100-row page boundary');
 const ids=leases.map(row=>row.id);
 assert.equal(await db.leaseAccrual.count({where:{leaseId:{in:ids}}}),101);
 assert.equal(await db.userLease.count({where:{id:{in:ids},settledDays:1,baseAccruedMicros:750000n}}),101);
 assert.deepEqual(await runEpochSettlement(url,now),{paused:false,processed:101});
 assert.equal(await db.leaseAccrual.count({where:{leaseId:{in:ids}}}),101,'timer replay must not duplicate accrual');
 const entries=await db.ledgerEntry.findMany({where:{userId:{in:users.map(row=>row.id)},kind:'EPOCH_YIELD'}});
 assert.equal(entries.length,101);assert.ok(entries.every(row=>row.amountMicros===750000n));
 const enabled=process.env.ENABLE_ACCRUAL;
 try{process.env.ENABLE_ACCRUAL='false';assert.deepEqual(await runEpochSettlement(url,now),{paused:true,processed:0})}
 finally{process.env.ENABLE_ACCRUAL=enabled}
 console.log('EPOCH CI PASSED: empty database, CLI, advisory lock, 101 leases and idempotent timer replay.');
}finally{await db.$disconnect()}
