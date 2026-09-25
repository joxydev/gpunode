import test from 'node:test';
import assert from 'node:assert/strict';
import {Address,beginCell,Cell,internal,storeMessageRelaxed,WalletContractV5R1,SendMode,toNano} from '@ton/ton';
import {keyPairFromSeed} from '@ton/crypto';
import {tonConfig} from '../src/ton/config.js';
import {buildJettonTransfer,buildStructuredJettonTransfer} from '../src/ton/jetton.js';
import {TonApiGasless,type RelayMessage} from '../src/ton/gasless.js';
import {validateEstimate,verifiedExternal,estimateMessage} from '../src/ton/gasless-messages.js';
import {GaslessDeposits} from '../src/deposits/gasless-service.js';
import type {PrismaClient,TonDeposit} from '@prisma/client';

const cfg=tonConfig({PUBLIC_URL:'https://31.77.226.26',TONCENTER_API_KEY:'example-only',ENABLE_TON_USDT_DEPOSITS:'true',ENABLE_TON_GASLESS:'true',TONAPI_API_KEY:'fake-test-key',OWNER_TELEGRAM_ID:'123'});
const keys=keyPairFromSeed(Buffer.alloc(32,7)),walletContract=WalletContractV5R1.create({workchain:0,publicKey:keys.publicKey});
const wallet=walletContract.address,jetton=Address.parse('0:'+'2'.repeat(64)),relay=Address.parse('0:'+'3'.repeat(64)),invoiceId='dep_'+'a'.repeat(32),queryId='12345',expiresAt=new Date(Date.now()+600000);
const transfer=buildJettonTransfer({sender:wallet,treasury:cfg.treasury,jettonWallet:jetton,usdtAmount:10000000n,queryId,invoiceId,responseDestination:relay,attachAmount:cfg.gaslessAttach,expiresAt});
const body=Cell.fromBase64(transfer.messages[0].payload);
const feeBody=beginCell().storeUint(0x0f8a7ea5,32).storeUint(9,64).storeCoins(100000n).storeAddress(relay).storeAddress(relay).storeBit(0).storeCoins(0).storeBit(0).endCell();
const toRaw=(cell:Cell):RelayMessage=>({address:jetton.toRawString(),amount:toNano('0.05').toString(),payload:cell.toBoc().toString('hex')});
const estimate={relayAddress:relay,from:wallet,commission:'100000',validUntil:Math.floor(Date.now()/1000)+240,protocolName:'gasless',messages:[toRaw(feeBody),toRaw(body)]};
const expected={wallet,jetton,treasury:cfg.treasury,invoiceId,queryId,requested:10000000n,relay,expiresAt,expectedBody:body};

test('TONAPI is separate, server-only, disabled without its key; official master must be supported',async()=>{
 const disabled=tonConfig({PUBLIC_URL:'https://31.77.226.26',ENABLE_TON_USDT_DEPOSITS:'true',TONCENTER_API_KEY:'test'});
 assert.equal(new TonApiGasless(disabled).enabled,false);
 let calls:{url:string;options:RequestInit}[]=[];
 const provider=new TonApiGasless(cfg,async(url,options)=>{
  calls.push({url:String(url),options:options||{}});
  if(String(url).endsWith('/config'))return new Response(JSON.stringify({relay_address:relay.toRawString(),gas_jettons:[{master_id:cfg.master.toRawString()}]}));
  if(String(url).includes('/estimate/'))return new Response(JSON.stringify({relay_address:relay.toRawString(),from:wallet.toRawString(),commission:estimate.commission,valid_until:estimate.validUntil,protocol_name:'gasless',messages:estimate.messages}));
  return new Response(JSON.stringify({protocol_name:'gasless',external:'test-trace'}));
 });
 assert.ok((await provider.relay())?.equals(relay));
 assert.ok((await provider.relay())?.equals(relay));
 const result=await provider.estimate(wallet,keys.publicKey.toString('hex'),estimateMessage(jetton,cfg.gaslessAttach,body));
 assert.equal(result.messages.length,2);
 const request=JSON.parse(String(calls[1].options.body));
 assert.equal(request.wallet_public_key,keys.publicKey.toString('hex'));
 assert.equal(request.throw_error_if_not_enough_jettons,true);
 assert.ok(/^[0-9a-f]+$/.test(request.messages[0].boc));
 assert.equal(calls[1].options.headers&&'Authorization' in calls[1].options.headers,cfg.tonApiKey&&true);
 assert.equal((await provider.send(keys.publicKey.toString('hex'),'abcd')).external,'test-trace');
 assert.equal(calls.length,3);
 const fake=new TonApiGasless(cfg,async()=>new Response(JSON.stringify({relay_address:relay.toRawString(),gas_jettons:[{master_id:wallet.toRawString()}]})));
 assert.equal(await fake.relay(),null);
});

test('gasless estimate preserves economic transfer and rejects mutations, fake fee and extra messages',()=>{
 const {fee,signRequest}=validateEstimate(estimate,expected);
 assert.equal(fee,100000n);assert.equal(signRequest.network,'-239');assert.equal(signRequest.messages.length,2);
 const economic=Cell.fromBase64(signRequest.messages[1].payload).beginParse();
 assert.equal(economic.loadUint(32),0x0f8a7ea5);assert.equal(economic.loadUintBig(64),BigInt(queryId));assert.equal(economic.loadCoins(),10000000n);
 assert.ok(economic.loadAddress()?.equals(cfg.treasury));assert.ok(economic.loadAddress()?.equals(relay));economic.loadBit();assert.equal(economic.loadCoins(),1n);
 assert.equal(economic.loadBit(),true);const comment=economic.loadRef().beginParse();comment.loadUint(32);assert.equal(comment.loadStringTail(),'AETHERMIND:'+invoiceId);
 assert.throws(()=>validateEstimate({...estimate,messages:[...estimate.messages,toRaw(body)]},expected));
 assert.throws(()=>validateEstimate({...estimate,commission:'200000'},expected));
 assert.throws(()=>validateEstimate({...estimate,relayAddress:wallet},expected));
 assert.throws(()=>validateEstimate({...estimate,messages:[toRaw(feeBody),toRaw(feeBody)]},expected));
 const otherInvoice=buildJettonTransfer({sender:wallet,treasury:cfg.treasury,jettonWallet:jetton,usdtAmount:10000000n,queryId,invoiceId:'dep_'+'b'.repeat(32),responseDestination:relay,attachAmount:cfg.gaslessAttach,expiresAt});
 assert.throws(()=>validateEstimate({...estimate,messages:[toRaw(feeBody),toRaw(Cell.fromBase64(otherInvoice.messages[0].payload))]},expected));
});

test('W5 signed internal BoC is verified against exact estimated messages before relaying',()=>{
 const {signRequest}=validateEstimate(estimate,expected);
 const messages=signRequest.messages.map(m=>internal({to:Address.parse(m.address),value:BigInt(m.amount),body:Cell.fromBase64(m.payload),bounce:true}));
 const signedBody=walletContract.createTransfer({seqno:0,secretKey:keys.secretKey,sendMode:SendMode.PAY_GAS_SEPARATELY,authType:'internal',timeout:signRequest.validUntil,messages});
 const boc=beginCell().store(storeMessageRelaxed(internal({to:wallet,value:1n,body:signedBody}))).endCell().toBoc().toString('base64');
 const verified={wallet,publicKey:keys.publicKey.toString('hex'),signRequest};
 const external=verifiedExternal(boc,verified);
 assert.ok(/^[0-9a-f]+$/.test(external));assert.equal(verifiedExternal(boc,verified),external);
 assert.throws(()=>verifiedExternal(boc,{...verified,publicKey:Buffer.alloc(32).toString('hex')}));
 assert.throws(()=>verifiedExternal(boc,{...verified,signRequest:{...signRequest,messages:[...signRequest.messages].reverse()}}));
 assert.throws(()=>verifiedExternal(boc,{...verified,wallet:relay}));
 const malicious=walletContract.createTransfer({seqno:0,secretKey:keys.secretKey,sendMode:SendMode.PAY_GAS_SEPARATELY,authType:'internal',timeout:signRequest.validUntil,messages:[messages[0],internal({to:jetton,value:1n,body:feeBody})]});
 assert.throws(()=>verifiedExternal(beginCell().store(storeMessageRelaxed(internal({to:wallet,value:1n,body:malicious}))).endCell().toBoc().toString('base64'),verified));
});

test('structured TON Connect item contains same invoice and amount, without guessed attach',()=>{
 const structured=buildStructuredJettonTransfer({sender:wallet,treasury:cfg.treasury,master:cfg.master,usdtAmount:10000000n,queryId,invoiceId,expiresAt});
 const item=structured.items[0];
 assert.equal(item.type,'jetton');assert.equal(item.amount,'10000000');assert.equal(item.queryId,queryId);assert.equal(item.forwardAmount,'1');
 assert.equal('attachAmount' in item,false);assert.ok(Address.parse(item.master).equals(cfg.master));
 const comment=Cell.fromBase64(item.forwardPayload).beginParse();assert.equal(comment.loadUint(32),0);assert.equal(comment.loadStringTail(),'AETHERMIND:'+invoiceId);
});

test('gasless send rejects foreign, cancelled, expired, invalid estimate; retry uses identical BoC and never credits',async()=>{
 const {signRequest,fee}=validateEstimate(estimate,expected);
 const signedBody=walletContract.createTransfer({seqno:0,secretKey:keys.secretKey,sendMode:SendMode.PAY_GAS_SEPARATELY,authType:'internal',timeout:signRequest.validUntil,messages:signRequest.messages.map(m=>internal({to:Address.parse(m.address),value:BigInt(m.amount),body:Cell.fromBase64(m.payload)}))});
 const internalBoc=beginCell().store(storeMessageRelaxed(internal({to:wallet,value:1n,body:signedBody}))).endCell().toBoc().toString('base64');
 assert.doesNotThrow(()=>verifiedExternal(internalBoc,{wallet,publicKey:keys.publicKey.toString('hex'),signRequest}));
 const base={id:'7c2bb844-a3bd-4fc1-a8c2-962148faab75',userId:'user',senderAddress:wallet.toRawString(),status:'PENDING',expiresAt,metadata:{gasless:{id:'e'.repeat(32),fee:fee.toString(),expiresAt:signRequest.validUntil,signRequest}}} as TonDeposit;
 let row=base,updates=0,ledgerCreates=0,attempts:string[]=[];
 const provider={enabled:true,send:async(_key:string,boc:string)=>{attempts.push(boc);if(attempts.length===1)throw Error('relayer timeout');return {external:'provider-hash'};}};
 const tx={ $queryRaw:async()=>[],tonDeposit:{findUniqueOrThrow:async()=>row,update:async({data}:{data:{metadata:any}})=>{row={...row,metadata:data.metadata};updates++;return row;}}};
 const db={tonDeposit:{findUnique:async()=>row},tonWallet:{findUnique:async()=>({verified:true,walletVersion:'W5',publicKey:keys.publicKey.toString('hex'),address:wallet.toRawString()})},$transaction:async(fn:(tx:typeof tx)=>Promise<any>)=>fn(tx),walletLedger:{create:async()=>{ledgerCreates++}}} as unknown as PrismaClient;
 const service=new GaslessDeposits(db,provider as unknown as TonApiGasless,false);
 await assert.rejects(service.send('other',base.id,{estimateId:'e'.repeat(32),internalBoc}));
 row={...base,status:'CANCELLED'};await assert.rejects(service.send('user',base.id,{estimateId:'e'.repeat(32),internalBoc}));
 row={...base,expiresAt:new Date(Date.now()-1)};await assert.rejects(service.send('user',base.id,{estimateId:'e'.repeat(32),internalBoc}));
 row=base;await assert.rejects(service.send('user',base.id,{estimateId:'f'.repeat(32),internalBoc}));
 await assert.rejects(service.send('user',base.id,{estimateId:'e'.repeat(32),internalBoc:'bad'}));assert.equal(updates,0);
 await assert.rejects(service.send('user',base.id,{estimateId:'e'.repeat(32),internalBoc}));
 assert.equal(updates,1);assert.equal(ledgerCreates,0);assert.equal(attempts.length,1);
 assert.deepEqual(await service.send('user',base.id,{estimateId:'e'.repeat(32)}),{submitted:false,processing:true});
 const meta=row.metadata as {gasless:{relayAttemptAt:number}};meta.gasless.relayAttemptAt-=16000;
 assert.deepEqual(await service.send('user',base.id,{estimateId:'e'.repeat(32)}),{submitted:true});
 assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);assert.equal(ledgerCreates,0);
 assert.deepEqual(await service.send('user',base.id,{estimateId:'e'.repeat(32)}),{submitted:true});
 assert.equal(attempts.length,2);
});
