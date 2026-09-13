import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {catalogueQuery,fixed,present,reserveLease,scaled,type CatalogRow,type Query} from '../src/market.js';

test('market migration, exact arithmetic and ACID reservation groundwork',async()=>{
 const db=new PGlite();
 try{
  await db.exec(readFileSync(new URL('../prisma/migrations/202609130001_initial/migration.sql',import.meta.url),'utf8'));
  await db.exec(`INSERT INTO "User"(id,name) VALUES ('12345','Existing user'),('67890','Other user'); INSERT INTO "LedgerEntry"(id,"userId","amountMicros",kind,"sourceId") VALUES ('old','12345',100000000,'CREDIT','old-credit');`);
  await db.exec(readFileSync(new URL('../prisma/migrations/202609130002_market/migration.sql',import.meta.url),'utf8'));
  const q:Query=async(sql,params)=>(await db.query(sql,params)).rows as any;
  const rows=await q<CatalogRow>('SELECT * FROM gpu_catalog ORDER BY tier_level');
  assert.equal(rows.length,4);assert.equal((await q('SELECT * FROM "LedgerEntry"')).length,1,'existing money retained');
  const daily=['1.750000','15.000000','78.000000','425.000000'];
  rows.forEach((r,i)=>{assert.equal(present(r).dailyUsdt,daily[i]);assert.equal(present(r).remainingPercent,null);assert.equal(present(r).canBuy,false);});
  assert.equal(present(rows[0]).aprPercent,'1277.50');assert.equal(present(rows[3]).availability,'CONCEPT');
  assert.equal(present({...rows[0],supply_known:true,total_supply:200,available_supply:42}).remainingPercent,21);
  assert.equal(present({...rows[0],supply_known:true,total_supply:200,available_supply:40}).availability,'LIMITED');
  assert.equal(present({...rows[0],supply_known:true,total_supply:200,available_supply:0}).availability,'SOLD_OUT');
  assert.equal(present({...rows[0],supply_known:true,total_supply:200,available_supply:180}).availability,'AVAILABLE');
  assert.throws(()=>catalogueQuery('ALL','price; DROP TABLE "User"'));
  const sorted=catalogueQuery('ENTERPRISE','price_desc');assert.equal((await q<CatalogRow>(sorted.sql,sorted.params))[0].id,'NODE_H100');
  assert.equal(fixed(scaled('123.45',2),2),'123.45');assert.throws(()=>scaled('1.001',2));
  const reserve=(id:string,key:string,enabled=true,user='12345')=>db.transaction(async tx=>reserveLease(async(sql,params)=>(await tx.query(sql,params)).rows as any,user,id,key,enabled));
  await assert.rejects(reserve('NODE_4090',randomUUID(),false),/CONTRACTS_NOT_CONNECTED/);
  await assert.rejects(reserve('NODE_4090',randomUUID()),/CONTRACTS_NOT_CONNECTED/);
  await db.exec("UPDATE gpu_catalog SET supply_known=TRUE,total_supply=2,available_supply=2,contract_reference='TEST-CONTRACT-ONLY',max_per_user=1 WHERE id='NODE_4090'");
  const key=randomUUID(),lease=await reserve('NODE_4090',key);
  assert.equal(lease.status,'PROVISIONING');assert.equal(lease.daily_yield_usdt,'1.7500');
  assert.equal((await reserve('NODE_4090',key)).id,lease.id,'retry does not charge twice');
  await assert.rejects(reserve('NODE_A100',key),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(reserve('NODE_4090',randomUUID()),/USER_LIMIT/);
  await assert.rejects(reserve('NODE_4090',randomUUID(),true,'67890'),/INSUFFICIENT_BALANCE/);
  assert.equal((await q("SELECT available_supply FROM gpu_catalog WHERE id='NODE_4090'"))[0].available_supply,1);
  assert.equal((await q('SELECT sum("amountMicros")::text AS n FROM "LedgerEntry" WHERE "userId"=\'12345\''))[0].n,'50000000');
  assert.equal((await q("SELECT * FROM \"LedgerEntry\" WHERE kind='DAILY_YIELD'")).length,0);
  await db.exec("UPDATE gpu_catalog SET max_per_user=5 WHERE id='NODE_4090'");
  // Force an error AFTER inventory + lease writes: the entire transaction must roll back.
  await assert.rejects(db.transaction(async tx=>reserveLease(async(sql,params)=>{if(sql.startsWith('INSERT INTO "LedgerEntry"'))throw Error('ledger failure');return (await tx.query(sql,params)).rows as any;},'12345','NODE_4090',randomUUID(),true)),/ledger failure/);
  assert.equal((await q('SELECT * FROM user_leases')).length,1);
  assert.equal((await q("SELECT available_supply FROM gpu_catalog WHERE id='NODE_4090'"))[0].available_supply,1);
  await reserve('NODE_4090',randomUUID());
  await assert.rejects(reserve('NODE_4090',randomUUID()),/SOLD_OUT/);
  await assert.rejects(db.exec("UPDATE gpu_catalog SET available_supply=-1 WHERE id='NODE_4090'"));
  assert.equal((await q('SELECT * FROM "User"')).length,2);
 }finally{await db.close();}
});
