import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createBrowserLogin,bindBrowserLogin,decideBrowserLogin,pollBrowserLogin} from '../src/browser-auth.js';
import type {Query} from '../src/market.js';
test('browser login: proof, confirmation owner, denial, expiry, replay and rate limit',async()=>{
 const db=new PGlite();
 try{
  await db.exec(readFileSync(new URL('../prisma/migrations/202609130001_initial/migration.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../prisma/migrations/202609150001_browser_login/migration.sql',import.meta.url),'utf8'));
  const tx=<T>(fn:(q:Query)=>Promise<T>)=>db.transaction(t=>fn(async(sql,params)=>(await t.query(sql,params)).rows as any));
  const c=await tx(q=>createBrowserLogin(q,'ip1'));
  assert.equal((await tx(q=>pollBrowserLogin(q,c.id,c.secret))).status,'PENDING');
  assert.equal(await tx(q=>decideBrowserLogin(q,c.id,{id:'123',name:'Unbound'},true)),false);
  assert.equal(await tx(q=>bindBrowserLogin(q,c.id,'123')),true);
  assert.equal(await tx(q=>bindBrowserLogin(q,c.id,'456')),false);
  assert.equal(await tx(q=>decideBrowserLogin(q,c.id,{id:'456',name:'Wrong'},true)),false);
  assert.equal(await tx(q=>decideBrowserLogin(q,c.id,{id:'123',name:'Alice'},true)),true);
  assert.equal((await tx(q=>pollBrowserLogin(q,c.id,'0'.repeat(64)))).status,'EXPIRED');
  const approved=await tx(q=>pollBrowserLogin(q,c.id,c.secret));assert.equal(approved.userId,'123');
  assert.equal((await tx(q=>pollBrowserLogin(q,c.id,c.secret))).status,'EXPIRED');
  assert.equal((await db.query('SELECT name FROM "User" WHERE id=\'123\'')).rows[0].name,'Alice');
  const d=await tx(q=>createBrowserLogin(q,'ip2'));await tx(q=>bindBrowserLogin(q,d.id,'456'));await tx(q=>decideBrowserLogin(q,d.id,{id:'456',name:'Bob'},false));
  assert.equal((await tx(q=>pollBrowserLogin(q,d.id,d.secret))).status,'DENIED');
  assert.equal((await db.query('SELECT * FROM "User" WHERE id=\'456\'')).rows.length,0);
  await db.query('UPDATE browser_logins SET expires_at=CURRENT_TIMESTAMP-INTERVAL \'1 second\' WHERE id=$1',[d.id]);
  assert.equal(await tx(q=>bindBrowserLogin(q,d.id,'456')),false);
  assert.equal((await tx(q=>pollBrowserLogin(q,d.id,d.secret))).status,'EXPIRED');
  for(let i=0;i<5;i++)await tx(q=>createBrowserLogin(q,'limited'));
  await assert.rejects(tx(q=>createBrowserLogin(q,'limited')),/Слишком много/);
 }finally{await db.close();}
});
