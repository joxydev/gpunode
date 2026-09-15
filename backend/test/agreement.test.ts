import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('agreement migration preserves users and stores version with acceptance time',async()=>{
 const db=new PGlite();
 try{
  await db.exec(readFileSync(new URL('../prisma/migrations/202609130001_initial/migration.sql',import.meta.url),'utf8'));
  await db.exec(`INSERT INTO "User"(id,name) VALUES ('12345','Existing user')`);
  await db.exec(readFileSync(new URL('../prisma/migrations/202609150002_user_agreement/migration.sql',import.meta.url),'utf8'));
  const before=(await db.query('SELECT name,"agreementVersion","agreementAcceptedAt" FROM "User" WHERE id=$1',['12345'])).rows[0] as any;
  assert.equal(before.name,'Existing user');assert.equal(before.agreementVersion,null);assert.equal(before.agreementAcceptedAt,null);
  await db.query('UPDATE "User" SET "agreementVersion"=$2,"agreementAcceptedAt"=CURRENT_TIMESTAMP WHERE id=$1',['12345','2026-09-14']);
  const accepted=(await db.query('SELECT "agreementVersion","agreementAcceptedAt" FROM "User" WHERE id=$1',['12345'])).rows[0] as any;
  assert.equal(accepted.agreementVersion,'2026-09-14');assert.ok(accepted.agreementAcceptedAt instanceof Date);
 }finally{await db.close();}
});
