import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=(name:string)=>readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),'utf8');
test('financial migration preserves legacy lease and account money, and rejects malformed modern snapshot',async()=>{
 const db=new PGlite();
 try{
  await db.exec(migration('202609130001_initial'));
  await db.exec("INSERT INTO \"User\"(id,name) VALUES ('12345','Legacy user'); INSERT INTO \"LedgerEntry\"(id,\"userId\",\"amountMicros\",kind,\"sourceId\") VALUES ('old','12345',50000000,'DEPOSIT','old-deposit');");
  await db.exec(migration('202609130002_market'));
  await db.exec(migration('202609220001_public_offer'));
  await db.exec("ALTER TABLE \"RentalRequest\" ADD COLUMN \"paymentStatus\" TEXT NOT NULL DEFAULT 'WAITING'; ALTER TABLE \"RentalRequest\" ADD COLUMN \"isTestOrder\" BOOLEAN NOT NULL DEFAULT FALSE; CREATE TABLE withdrawal_requests (id UUID PRIMARY KEY,fee_micros BIGINT); INSERT INTO user_leases(id,user_id,node_id,purchase_price,daily_yield_usdt,contract_reference,idempotency_key,expires_at) VALUES ('12345678-1234-1234-1234-123456789001','12345','NODE_4090',50,0.7500,'legacy','12345678-1234-1234-1234-123456789002',now()+INTERVAL '30 days');");
  await db.exec(migration('202609290001_financial_cycle'));
  const old=(await db.query<{offer_version:string|null;status:string}>("SELECT offer_version,status FROM user_leases WHERE user_id='12345'")).rows[0];
  assert.equal(old.offer_version,null);assert.equal(old.status,'PROVISIONING');
  assert.equal((await db.query<{amount:string}>("SELECT sum(\"amountMicros\")::text amount FROM \"LedgerEntry\" WHERE \"userId\"='12345'")).rows[0].amount,'50000000');
  await db.exec("INSERT INTO user_leases(id,user_id,node_id,purchase_price,daily_yield_usdt,contract_reference,idempotency_key,expires_at,offer_version,offer_document_sha256,mode,principal_micros,base_daily_rate_bps,compound_daily_rate_bps,contract_days,compound_cycle_days,terms_snapshot) VALUES ('12345678-1234-1234-1234-123456789003','12345','NODE_4090',50,0.7500,'new','12345678-1234-1234-1234-123456789004',NULL,'financial-edition',repeat('a',64),'BASE',50000000,150,180,30,30,'{}');");
  assert.equal((await db.query<{epoch_ends_at:string|null}>("SELECT epoch_ends_at FROM user_leases WHERE offer_version='financial-edition'")).rows[0].epoch_ends_at,null);
  await assert.rejects(db.exec("UPDATE user_leases SET principal_micros=-1 WHERE offer_version='financial-edition'"),/Immutable financial lease terms/);
  await assert.rejects(db.exec("INSERT INTO lease_accruals(lease_id,day_index,mode,opening_principal_micros,rate_bps,yield_micros,closing_principal_micros,compound_block) VALUES ('12345678-1234-1234-1234-123456789003',0,'BASE',50000000,150,750000,50000000,0)"),/check/);
 }finally{await db.close()}
});
