import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign as edSign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Address,beginCell,Cell,storeStateInit,WalletContractV5R1} from '@ton/ton';
import {PGlite} from '@electric-sql/pglite';
import {tonConfig,usdtUnits} from '../src/ton/config.js';
import {verifyTonProof} from '../src/ton/proof.js';
import {jettonPayment} from '../src/ton/jetton.js';
import {parseNotification} from '../src/ton/notification.js';

const config=tonConfig({PUBLIC_URL:'https://31.77.226.26',ENABLE_TON_USDT_DEPOSITS:'false'});
const sha=(b:Buffer)=>createHash('sha256').update(b).digest();
test('TON Proof binds public key, stateInit, nonce, domain, network and time',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const key=publicKey.export({type:'spki',format:'der'}).subarray(-32);
 const wallet=WalletContractV5R1.create({workchain:0,publicKey:key});
 const state=beginCell().store(storeStateInit(wallet.init)).endCell().toBoc().toString('base64');
 const payload='a'.repeat(64),timestamp=Math.floor(Date.now()/1000),domain=Buffer.from(config.domain);
 const len=Buffer.alloc(4);len.writeUInt32LE(domain.length);
 const ts=Buffer.alloc(8);ts.writeBigUInt64LE(BigInt(timestamp));
 const wc=Buffer.alloc(4);wc.writeInt32BE(0);
 const msg=Buffer.concat([Buffer.from('ton-proof-item-v2/'),wc,wallet.address.hash,len,domain,ts,Buffer.from(payload)]);
 const digest=sha(Buffer.concat([Buffer.from([255,255]),Buffer.from('ton-connect'),sha(msg)]));
 const input={address:wallet.address.toRawString(),network:'-239',walletStateInit:state,proof:{timestamp,domain:{lengthBytes:domain.length,value:config.domain},payload,signature:edSign(null,digest,privateKey).toString('base64')}};
 const noGetter={publicKey:async()=>{throw Error('on-chain lookup should not be needed')}};
 assert.equal(await verifyTonProof(input,payload,config,noGetter),wallet.address.toRawString());
 await assert.rejects(verifyTonProof(input,'b'.repeat(64),config,noGetter));
 await assert.rejects(verifyTonProof({...input,network:'-3'},payload,config,noGetter));
 await assert.rejects(verifyTonProof({...input,proof:{...input.proof,domain:{lengthBytes:7,value:'evil.com'}}},payload,config,noGetter));
 await assert.rejects(verifyTonProof({...input,proof:{...input.proof,timestamp:timestamp-3600}},payload,config,noGetter));
 await assert.rejects(verifyTonProof({...input,proof:{...input.proof,signature:Buffer.alloc(64).toString('base64')}},payload,config,noGetter));
 await assert.rejects(verifyTonProof({...input,address:config.treasury.toRawString()},payload,config,noGetter));
});

test('USDT is exact base units, transaction is Jetton transfer with tagged invoice',()=>{
 assert.equal(usdtUnits('50.000001'),50000001n);
 for(const value of ['0','0.0000001','-1','1e6','0.01x',50])assert.throws(()=>usdtUnits(value));
 assert.throws(()=>tonConfig({USDT_TON_MASTER:config.treasury.toRawString()}));
 const invoice='dep_'+'f'.repeat(32),queryId='42',amount=50000001n;
 const built=jettonPayment(config.treasury,config.treasury,config.master,amount,queryId,invoice,new Date(Date.now()+900000));
 assert.equal(built.network,'-239');assert.equal(built.messages.length,1);assert.ok(BigInt(built.messages[0].amount)>0n);
 const slice=Cell.fromBase64(built.messages[0].payload).beginParse();
 assert.equal(slice.loadUint(32),0x0f8a7ea5);assert.equal(slice.loadUintBig(64),42n);assert.equal(slice.loadCoins(),amount);
 assert.ok(slice.loadAddress()?.equals(config.treasury));slice.loadAddress();assert.equal(slice.loadBit(),false);
 assert.ok(slice.loadCoins()>0n);assert.equal(slice.loadBit(),true);const forward=slice.loadRef().beginParse();assert.equal(forward.loadUint(32),0);assert.equal(forward.loadStringTail(),'AETHERMIND:'+invoice);
});

test('incoming notification rejects fake master wallet, bounce, missing invoice or aborted transfer',()=>{
 const invoice='dep_'+'f'.repeat(32);
 const sender=Address.parse('UQBHmBs516S1EKkDLj9K-hwCD-WlvRn05ieMiScK-pBBO8iH');
 const jetton=Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs');
 const comment=beginCell().storeUint(0,32).storeStringTail('AETHERMIND:'+invoice).endCell();
 const body=beginCell().storeUint(0x7362d09c,32).storeUint(42,64).storeCoins(50000000n).storeAddress(sender).storeBit(1).storeRef(comment).endCell().toBoc().toString('base64');
 const tx={hash:'a'.repeat(64),account:sender.toRawString(),now:Math.floor(Date.now()/1000),description:{aborted:false,compute_ph:{success:true}},in_msg:{source:jetton.toRawString(),destination:sender.toRawString(),bounced:false,message_content:{body}},out_msgs:[]};
 assert.equal(parseNotification(tx,config,jetton)?.invoiceId,invoice);
 assert.equal(parseNotification({...tx,in_msg:{...tx.in_msg,source:sender.toRawString()}},config,jetton),null);
 assert.equal(parseNotification({...tx,description:{aborted:true}},config,jetton),null);
 assert.equal(parseNotification({...tx,in_msg:{...tx.in_msg,bounced:true}},config,jetton),null);
 const missing=beginCell().storeUint(0x7362d09c,32).storeUint(42,64).storeCoins(50000000n).storeAddress(sender).storeBit(1).storeRef(beginCell().storeUint(0,32).storeStringTail('unrelated').endCell()).endCell().toBoc().toString('base64');
 assert.equal(parseNotification({...tx,in_msg:{...tx.in_msg,message_content:{body:missing}}},config,jetton)?.invoiceId,null);
});

test('invoice migration accepts cancellation and still constrains duplicate transactions',async()=>{
 const db=new PGlite();const migration=(name:string)=>readFileSync(new URL('../prisma/migrations/'+name+'/migration.sql',import.meta.url),'utf8');
 try{
  for(const name of ['202609130001_initial','202609130002_market','202609150001_browser_login','202609150002_user_agreement','202609150003_managed_requests','202609190001_owner_support','202609220001_public_offer','202609220002_owner_center','202609230001_user_language','202609230002_test_cycle','202609240001_ton_usdt_deposits','202609240002_cancel_invoice'])await db.exec(migration(name));
  await db.exec("INSERT INTO \"User\"(id,name) VALUES ('2','User');");
  await db.exec("INSERT INTO deposits(invoice_id,user_id,sender_address,recipient_address,jetton_master,requested_micros,query_id,expires_at) VALUES ('dep_test','2','0:0000000000000000000000000000000000000000000000000000000000000000','0:0000000000000000000000000000000000000000000000000000000000000000','0:0000000000000000000000000000000000000000000000000000000000000000',50000000,'7',now()+interval '20 minutes')");
  await assert.rejects(db.exec("INSERT INTO deposits(invoice_id,user_id,sender_address,recipient_address,jetton_master,requested_micros,query_id,expires_at) SELECT invoice_id,user_id,sender_address,recipient_address,jetton_master,requested_micros,query_id,expires_at FROM deposits"));
  await db.exec("UPDATE deposits SET status='CANCELLED' WHERE invoice_id='dep_test'");
  const result=await db.query<{status:string}>("SELECT status FROM deposits WHERE invoice_id='dep_test'");assert.equal(result.rows[0].status,'CANCELLED');
  await assert.rejects(db.exec("INSERT INTO test_ledger_entries(user_id,amount_micros,kind,source_id,actor_id,reason) VALUES ('2',1000000,'MANUAL_CREDIT','retired','1','No credits')"));
 }finally{await db.close()}
});
