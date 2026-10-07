import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {destination,parseWithdrawal,WITHDRAWAL_TRANSITIONS} from '../src/production.js';

test('stage 2 migration is additive and preserves previous user, ticket and ledger data',async()=>{
 const db=new PGlite();
 try{
  const base=new URL('../prisma/migrations/',import.meta.url);
  for(const dir of readdirSync(base).filter(name=>/^\d/.test(name)).sort()){
   if(dir==='202609280001_production_operations')break;
   await db.exec(readFileSync(new URL(dir+'/migration.sql',base),'utf8'));
  }
  const ticket=randomUUID(),ledger=randomUUID();
  await db.query('INSERT INTO "User" (id,name) VALUES ($1,$2)', ['101','Existing user']);
  await db.query('INSERT INTO "Ticket" (id,"userId",message,"updatedAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP)',[ticket,'101','Old support ticket']);
  await db.query('INSERT INTO "LedgerEntry" (id,"userId","amountMicros",kind,"sourceId") VALUES ($1,$2,$3,$4,$5)',[ledger,'101','2000000','DEPOSIT_CONFIRMED','existing-deposit']);
  await db.exec(readFileSync(new URL('202609280001_production_operations/migration.sql',base),'utf8'));
  await assert.rejects(db.query('INSERT INTO "Ticket" (id,"userId",message,"updatedAt",category) VALUES ($1,$2,$3,CURRENT_TIMESTAMP,$4)',[randomUUID(),'101','New payment issue','PAYMENT']),'old CHECK must reject production categories');
  await db.exec(readFileSync(new URL('202609280002_support_categories/migration.sql',base),'utf8'));
  assert.equal((await db.query('SELECT message,reference_type FROM "Ticket" WHERE id=$1',[ticket])).rows[0].message,'Old support ticket');
  for(const category of ['QUESTION','COMPLAINT','PAYMENT','WITHDRAWAL','ACCOUNT','WALLET','NODE','TECHNICAL','OTHER']){
   await db.query('INSERT INTO "Ticket" (id,"userId",message,"updatedAt",category) VALUES ($1,$2,$3,CURRENT_TIMESTAMP,$4)',[randomUUID(),'101','Supported issue',category]);
  }
  await assert.rejects(db.query('INSERT INTO "Ticket" (id,"userId",message,"updatedAt",category) VALUES ($1,$2,$3,CURRENT_TIMESTAMP,$4)',[randomUUID(),'101','Unsupported issue','INVALID']));
  assert.equal(Number((await db.query('SELECT "amountMicros" FROM "LedgerEntry" WHERE id=$1',[ledger])).rows[0].amountMicros),2000000);
  const notice=randomUUID();
  await db.query('INSERT INTO notifications (id,user_id,type,title,message,dedupe_key) VALUES ($1,$2,$3,$4,$5,$6)',[notice,'101','DEPOSIT_CREDITED','Deposit','2 USDT','deposit:existing:CREDITED']);
  await assert.rejects(db.query('INSERT INTO notifications (id,user_id,type,title,message,dedupe_key) VALUES ($1,$2,$3,$4,$5,$6)',[randomUUID(),'101','DEPOSIT_CREDITED','Duplicate','2 USDT','deposit:existing:CREDITED']));
  assert.equal((await db.query('SELECT is_read FROM notifications WHERE id=$1',[notice])).rows[0].is_read,false);
  const withdrawal=randomUUID(),key=randomUUID();
  await db.query('INSERT INTO withdrawal_requests (id,user_id,idempotency_key,destination_address,amount_micros) VALUES ($1,$2,$3,$4,$5)',[withdrawal,'101',key,'0:'+'a'.repeat(64),'1000000']);
  await assert.rejects(db.query('INSERT INTO withdrawal_requests (id,user_id,idempotency_key,destination_address,amount_micros) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),'101',key,'0:'+'a'.repeat(64),'1000000']));
  await assert.rejects(db.query('UPDATE withdrawal_requests SET amount_micros=0 WHERE id=$1',[withdrawal]));
  await assert.rejects(db.query("UPDATE withdrawal_requests SET status='COMPLETED' WHERE id=$1",[withdrawal]));
 }finally{await db.close()}
});

test('withdrawal input accepts only a checksum-valid TON Mainnet friendly address and exact USDT units',()=>{
 const address='UQBHmBs516S1EKkDLj9K-hwCD-WlvRn05ieMiScK-pBBO8iH';
 const input={asset:'USDT',network:'TON',destinationAddress:address,amount:'10.000001',idempotencyKey:randomUUID()};
 assert.equal(parseWithdrawal(input).amount,10000001n);
 assert.equal(destination(address),address);
 for(const invalid of ['0:'+'a'.repeat(64),address.slice(0,-1)+'A','kQBHmBs516S1EKkDLj9K-hwCD-WlvRn05ieMiScK-pBBO8iH'])assert.throws(()=>destination(invalid));
 for(const amount of ['0','-1','1.0000001','9.999999','NaN'])assert.throws(()=>parseWithdrawal({...input,amount}));
 assert.throws(()=>parseWithdrawal({...input,network:'TRC20'}));
});

test('completed or processing withdrawals cannot release a reservation without a valid prior state',()=>{
 assert.deepEqual(WITHDRAWAL_TRANSITIONS.REQUESTED,['UNDER_REVIEW','REJECTED','CANCELLED']);
 assert.deepEqual(WITHDRAWAL_TRANSITIONS.PROCESSING,['COMPLETED']);
 assert.deepEqual(WITHDRAWAL_TRANSITIONS.COMPLETED,[]);
});
