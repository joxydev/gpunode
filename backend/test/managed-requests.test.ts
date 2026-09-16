import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('managed request migration preserves historical profiles and allows service-managed requests',async()=>{
 const db=new PGlite();
 try{
  await db.exec(readFileSync(new URL('../prisma/migrations/202609130001_initial/migration.sql',import.meta.url),'utf8'));
  await db.exec(`INSERT INTO "User"(id,name) VALUES ('1','Existing user');
   INSERT INTO "RentalRequest"(id,"userId","nodeId",profile,workload,"idempotencyKey","updatedAt") VALUES ('old','1','rtx4090','ECO','Original request','old-key',CURRENT_TIMESTAMP)`);
  await db.exec(readFileSync(new URL('../prisma/migrations/202609150003_managed_requests/migration.sql',import.meta.url),'utf8'));
  assert.equal((await db.query<{profile:string}>(`SELECT profile FROM "RentalRequest" WHERE id='old'`)).rows[0].profile,'ECO');
  await db.exec(`INSERT INTO "RentalRequest"(id,"userId","nodeId",profile,workload,"idempotencyKey","updatedAt") VALUES ('new','1','rtx4090','MANAGED','Managed request','new-key',CURRENT_TIMESTAMP)`);
  assert.equal((await db.query<{profile:string}>(`SELECT profile FROM "RentalRequest" WHERE id='new'`)).rows[0].profile,'MANAGED');
  await assert.rejects(db.exec(`UPDATE "RentalRequest" SET profile='INVALID' WHERE id='new'`));
 }finally{await db.close();}
});
