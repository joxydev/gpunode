import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {MAX_LEDGER_MICROS,parseCredit} from '../src/admin-credit.js';
import {normalizeCreditAmount,exactMoney} from '../../frontend/src/exact-money.js';

test('credit amount is exact, bounded and normalized together with the reason',()=>{
 const key=randomUUID();const result=parseCredit({amount:' 12,345678 ',reason:'  Returned\n  payment  ',idempotencyKey:key.toUpperCase()});
 assert.deepEqual(result,{amountMicros:12345678n,reason:'Returned payment',idempotencyKey:key});
 assert.equal(parseCredit({amount:'0.000001',reason:'Test credit',idempotencyKey:key}).amountMicros,1n);
 assert.equal(parseCredit({amount:'9223372036854.775807',reason:'Test credit',idempotencyKey:key}).amountMicros,MAX_LEDGER_MICROS);
 for(const amount of ['0','0.000000','-1','NaN','Infinity','1e2','1.1234567','9223372036854.775808','99999999999999999','1,2.3','01','1.','+5',12.345678,null])assert.throws(()=>parseCredit({amount,reason:'Valid reason',idempotencyKey:key}));
 for(const reason of ['', 'ab', 'x'.repeat(501), '\0bad', 5])assert.throws(()=>parseCredit({amount:'1',reason,idempotencyKey:key}));
 for(const input of [{amount:'1',reason:'Test',idempotencyKey:'bad'},{amount:'1',reason:'Test',idempotencyKey:key,actorId:'11111'},null,[]])assert.throws(()=>parseCredit(input));
 assert.equal(normalizeCreditAmount('12,345678'),'12.345678');assert.equal(normalizeCreditAmount('0.000001'),'0.000001');assert.equal(normalizeCreditAmount('1e2'),null);
 assert.equal(exactMoney('12.345678','en-US'),'12.345678');assert.equal(exactMoney('0.000001','ro-RO'),'0,000001');assert.equal(exactMoney('9223372036854.775807','en-US'),'9,223,372,036,854.775807');
 assert.equal(exactMoney('-0.000001','ru-RU'),'-0,000001');
});
test('additive credit migration preserves balances and enforces operation linkage, keys and range',async()=>{
 const db=new PGlite();const base=new URL('../prisma/migrations/',import.meta.url);
 try{
  for(const dir of readdirSync(base).filter(d=>/^\d/.test(d)).sort()){
   if(dir==='20261008000100_admin_balance_credit')break;
   await db.exec(readFileSync(new URL(dir+'/migration.sql',base),'utf8'));
  }
  await db.exec(`INSERT INTO "User"(id,name) VALUES ('11111','Owner'),('22222','Recipient');INSERT INTO "LedgerEntry"(id,"userId","amountMicros",kind,"sourceId") VALUES ('legacy','22222',12345678,'DEPOSIT_CONFIRMED','legacy');`);
  await db.exec(readFileSync(new URL('20261008000100_admin_balance_credit/migration.sql',base),'utf8'));
  assert.equal((await db.query<{total:string}>(`SELECT SUM("amountMicros")::text AS total FROM "LedgerEntry"`)).rows[0].total,'12345678');
  const key=randomUUID(),id=randomUUID();await db.query(`INSERT INTO "LedgerEntry"(id,"userId","amountMicros",kind,"sourceId") VALUES ('credit','22222',1,'ADMIN_CREDIT',$1)`,['admin-credit:'+id]);await db.query(`INSERT INTO "AdminBalanceCredit"(id,"actorId","userId","amountMicros",reason,"idempotencyKey","ledgerId","balanceBeforeMicros","balanceAfterMicros") VALUES ($1,'11111','22222',1,'Test reason',$2,'credit',12345678,12345679)`,[id,key]);
  for(const update of [`"amountMicros"=0`,`"balanceAfterMicros"=5`,`"userId"='99999'`,`"ledgerId"='missing'`,`reason=repeat('x',501)`])await assert.rejects(db.exec(`UPDATE "AdminBalanceCredit" SET ${update}`));
  await assert.rejects(db.exec(`DELETE FROM "LedgerEntry" WHERE id='credit'`));
  // No rollback script may remove ledger rows or the additive model.
  assert.equal((await db.query(`SELECT * FROM "AdminBalanceCredit"`)).rows.length,1);
 }finally{await db.close()}
});
