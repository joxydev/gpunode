import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('owner center migration backfills conversations and constrains payment state',async()=>{
 const db=new PGlite();
 const migration=(name:string)=>readFileSync(new URL('../prisma/migrations/'+name+'/migration.sql',import.meta.url),'utf8');
 try{
  await db.exec(migration('202609130001_initial'));
  await db.exec(`
   INSERT INTO "User"(id,name) VALUES ('1','Existing user');
   INSERT INTO "RentalRequest"(id,"userId","nodeId",profile,workload,status,"idempotencyKey","updatedAt") VALUES ('r','1','NODE_4090','ECO','Legacy request','REQUESTED','legacy-key',now());
   INSERT INTO "Ticket"(id,"userId",message,reply,"createdAt","updatedAt") VALUES ('t','1','Original question','Original answer',now()-interval '1 hour',now());
  `);
  await db.exec(migration('202609130002_market'));
  await db.exec(migration('202609150001_browser_login'));
  await db.exec(migration('202609150002_user_agreement'));
  await db.exec(migration('202609150003_managed_requests'));
  await db.exec(migration('202609190001_owner_support'));
  await db.exec(migration('202609220001_public_offer'));
  await db.exec(migration('202609220002_owner_center'));

  const request=(await db.query<{paymentStatus:string}>('SELECT "paymentStatus" FROM "RentalRequest" WHERE id=\'r\'')).rows[0];
  assert.equal(request.paymentStatus,'WAITING');
  const messages=(await db.query<{author_type:string;body:string}>('SELECT author_type,body FROM ticket_messages WHERE ticket_id=\'t\' ORDER BY created_at,id')).rows;
  assert.deepEqual(messages.map(row=>[row.author_type,row.body]),[['USER','Original question'],['OWNER','Original answer']]);
  const ticket=(await db.query<{ownerUnread:boolean;userUnread:boolean;status:string}>('SELECT "ownerUnread","userUnread",status FROM "Ticket" WHERE id=\'t\'')).rows[0];
  assert.equal(ticket.status,'ANSWERED');assert.equal(ticket.ownerUnread,false);assert.equal(ticket.userUnread,true);

  await assert.rejects(db.exec(`UPDATE "RentalRequest" SET "paymentStatus"='MANUAL' WHERE id='r'`));
  await assert.rejects(db.exec(`INSERT INTO ticket_messages(ticket_id,author_type,author_id,body) VALUES ('t','BOT','x','No')`));
  await assert.rejects(db.exec(`UPDATE "Ticket" SET status='CLOSED' WHERE id='t'`));
  await db.exec(`UPDATE "Ticket" SET status='CLOSED',"closedAt"=now() WHERE id='t'`);
  await assert.rejects(db.exec(`UPDATE "Ticket" SET status='OPEN' WHERE id='t'`));
  await db.exec(`UPDATE "Ticket" SET status='OPEN',"closedAt"=NULL WHERE id='t'`);
 }finally{await db.close()}
});
