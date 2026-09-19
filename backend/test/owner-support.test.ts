import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('owner migration preserves existing data and enforces decisions and ticket states',async()=>{
 const db=new PGlite();try{
 const migration=(name:string)=>readFileSync(new URL('../prisma/migrations/'+name+'/migration.sql',import.meta.url),'utf8');
 await db.exec(migration('202609130001_initial'));
 await db.exec(`INSERT INTO "User"(id,name) VALUES ('1','User');INSERT INTO "Ticket"(id,"userId",message,reply,"updatedAt") VALUES ('t','1','Question','Answer',now());INSERT INTO "RentalRequest"(id,"userId","nodeId",profile,workload,status,"idempotencyKey","updatedAt") VALUES ('r','1','rtx4090','ECO','Existing','CLOSED','key',now());`);
 await db.exec(migration('202609190001_owner_support'));
 assert.equal((await db.query<{status:string}>('SELECT status FROM "Ticket"')).rows[0].status,'ANSWERED');
 assert.equal((await db.query<{workload:string}>('SELECT workload FROM "RentalRequest"')).rows[0].workload,'Existing');
 await assert.rejects(db.exec(`UPDATE "RentalRequest" SET decision='ACCEPTED' WHERE id='r'`));
 await db.exec(`UPDATE "RentalRequest" SET decision='ACCEPTED',"closureReason"='Confirmed',"closedAt"=now() WHERE id='r'`);
 await assert.rejects(db.exec(`UPDATE "RentalRequest" SET status='REVIEWED' WHERE id='r'`));
 await assert.rejects(db.exec(`UPDATE "Ticket" SET status='INVALID' WHERE id='t'`));
 await assert.rejects(db.exec(`UPDATE "Ticket" SET category='INVALID' WHERE id='t'`));
 }finally{await db.close()}
});
