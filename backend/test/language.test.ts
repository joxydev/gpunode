import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('language migration preserves users and restricts preferences to supported locales',async()=>{
 const db=new PGlite();
 try{
  const initial=readFileSync(new URL('../prisma/migrations/202609130001_initial/migration.sql',import.meta.url),'utf8');
  const migration=readFileSync(new URL('../prisma/migrations/202609230001_user_language/migration.sql',import.meta.url),'utf8');
  await db.exec(initial);
  await db.exec(`INSERT INTO "User"(id,name) VALUES ('1','Existing user')`);
  await db.exec(migration);
  const before=(await db.query<{name:string;preferredLanguage:string|null}>(`SELECT name,"preferredLanguage" FROM "User" WHERE id='1'`)).rows[0];
  assert.deepEqual(before,{name:'Existing user',preferredLanguage:null});
  for(const language of ['ru','en','ro']){
   await db.query('UPDATE "User" SET "preferredLanguage"=$1 WHERE id=$2',[language,'1']);
   assert.equal((await db.query<{preferredLanguage:string}>(`SELECT "preferredLanguage" FROM "User" WHERE id='1'`)).rows[0].preferredLanguage,language);
  }
  await assert.rejects(db.query('UPDATE "User" SET "preferredLanguage"=$1 WHERE id=$2',['de','1']));
 }finally{await db.close()}
});
