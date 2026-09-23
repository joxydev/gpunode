import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('test accounting migration preserves real balances and constrains orders and assets',async()=>{
 const db=new PGlite();const migration=(name:string)=>readFileSync(new URL('../prisma/migrations/'+name+'/migration.sql',import.meta.url),'utf8');
 try{
  for(const name of ['202609130001_initial','202609130002_market','202609150001_browser_login','202609150002_user_agreement','202609150003_managed_requests','202609190001_owner_support','202609220001_public_offer','202609220002_owner_center','202609230001_user_language'])await db.exec(migration(name));
  await db.exec(`INSERT INTO "User"(id,name) VALUES ('2','User'); INSERT INTO "LedgerEntry"(id,"userId","amountMicros",kind,"sourceId") VALUES ('l','2',12000000,'DEPOSIT_CONFIRMED','test-real');`);
  await db.exec(migration('202609230002_test_cycle'));
  assert.equal((await db.query<{amountMicros:bigint}>('SELECT "amountMicros" FROM "LedgerEntry" WHERE id=\'l\'')).rows[0].amountMicros,12000000);
  await db.exec(`INSERT INTO test_ledger_entries(user_id,amount_micros,kind,source_id,actor_id,reason) VALUES ('2',50000000,'MANUAL_CREDIT','owner-1','1','Testing credit');`);
  assert.equal(Number((await db.query<{amount_micros:bigint}>('SELECT sum(amount_micros) AS amount_micros FROM test_ledger_entries WHERE user_id=\'2\'')).rows[0].amount_micros),50000000);
  await assert.rejects(db.exec(`INSERT INTO test_ledger_entries(user_id,amount_micros,kind,source_id,actor_id,reason) VALUES ('2',-100,'MANUAL_CREDIT','invalid','1','Testing')`));
  await assert.rejects(db.exec(`INSERT INTO test_ledger_entries(user_id,amount_micros,kind,source_id,actor_id,reason) VALUES ('2',100,'MANUAL_CREDIT','owner-1','1','Double credit')`));
  await db.exec(`INSERT INTO "RentalRequest"(id,"userId","nodeId",profile,workload,status,"idempotencyKey","updatedAt","isTestOrder","testPriceMicros","testTermDays","testRateBps","testOfferVersion","paymentStatus") VALUES ('o','2','NODE_4090','MANAGED','Testing','REQUESTED','test-key',now(),true,50000000,30,150,'offer-test','TEST_CREDIT')`);
  await assert.rejects(db.exec(`INSERT INTO "RentalRequest"(id,"userId","nodeId",profile,workload,status,"idempotencyKey","updatedAt","isTestOrder","paymentStatus") VALUES ('bad','2','NODE_4090','MANAGED','Testing','REQUESTED','bad-key',now(),true,'TEST_CREDIT')`));
  await db.exec(`INSERT INTO test_assets(request_id,user_id,node_id,price_micros,term_days,rate_bps) VALUES ('o','2','NODE_4090',50000000,30,150)`);
  await assert.rejects(db.exec(`INSERT INTO test_assets(request_id,user_id,node_id,price_micros,term_days,rate_bps) VALUES ('o','2','NODE_4090',50000000,30,150)`));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM user_leases')).rows[0].n,0);
 }finally{await db.close()}
});
