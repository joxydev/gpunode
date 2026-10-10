import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('catalogue limit upgrade after the applied network migrations preserves stock, contracts and money',async()=>{
 const db=new PGlite();
 const root=new URL('../prisma/migrations/',import.meta.url);
 const name='202610100004_catalog_tariff_limit';
 try{
  for(const prior of readdirSync(root).filter(n=>/^\d/.test(n)&&n<name).sort())
   await db.exec(readFileSync(new URL(`${prior}/migration.sql`,root),'utf8'));
  assert.deepEqual((await db.query<{max_per_user:number}>('SELECT max_per_user FROM gpu_catalog ORDER BY tier_level')).rows.map(r=>r.max_per_user),[5,3,2,1]);
  await db.exec(`INSERT INTO "User"(id,name) VALUES ('12345','Existing user');
   INSERT INTO "LedgerEntry"(id,"userId","amountMicros",kind,"sourceId") VALUES ('limit-fixture','12345',50000000,'DEPOSIT','limit-fixture');
   UPDATE gpu_catalog SET supply_known=true,total_supply=95,available_supply=83,contract_reference='REF-ALPHA-2026-01' WHERE id='NODE_4090';
   INSERT INTO user_leases(id,user_id,node_id,purchase_price,daily_yield_usdt,contract_reference,idempotency_key,expires_at)
   VALUES ('12345678-1234-1234-1234-123456789001','12345','NODE_4090',50,0.7500,'legacy','12345678-1234-1234-1234-123456789002',now()+INTERVAL '30 days');
   INSERT INTO offer_acceptances(user_id,version,document_sha256,client_hash) VALUES ('12345','existing-edition',repeat('a',64),repeat('b',64));`);
  const snapshot=async()=>({
   catalog:(await db.query('SELECT to_jsonb(c)-\'max_per_user\' value FROM gpu_catalog c ORDER BY tier_level')).rows,
   leases:(await db.query('SELECT * FROM user_leases ORDER BY id')).rows,
   money:(await db.query('SELECT * FROM "LedgerEntry" ORDER BY id')).rows,
   acceptances:(await db.query('SELECT * FROM offer_acceptances ORDER BY id')).rows,
  });
  const before=await snapshot(),sql=readFileSync(new URL(`${name}/migration.sql`,root),'utf8');
  await db.exec(sql);
  assert.deepEqual((await db.query<{max_per_user:number}>('SELECT max_per_user FROM gpu_catalog ORDER BY tier_level')).rows.map(r=>r.max_per_user),[1,1,1,1]);
  assert.deepEqual(await snapshot(),before);
  await db.exec(sql);
  assert.deepEqual(await snapshot(),before);
 }finally{await db.close()}
});
