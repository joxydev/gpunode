// CI only: starts the real Nest API against an isolated aethermind_ci database.
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

if(process.env.CI_INTEGRATION!=='1'||new URL(process.env.DATABASE_URL).pathname!=='/aethermind_ci')throw Error('Refusing to run integration tests against non-CI database');
const port=process.env.CI_PORT||'3100';
const child=spawn(process.execPath,['backend/dist/main.js'],{stdio:['ignore','inherit','inherit'],env:{...process.env,PORT:port}});
const base='http://127.0.0.1:'+port+'/api';
async function call(path,token,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});let data;try{data=await r.json()}catch{data={}}return {status:r.status,data}}
async function login(id,startParam){const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'CI user '+id})});if(startParam)p.set('start_param',startParam);const key=createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();p.set('hash',createHmac('sha256',key).update([...p.entries()].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));const r=await call('/auth/telegram',null,{initData:p.toString()});assert.equal(r.status,201);return r.data.token}
const agreement=token=>call('/agreement/accept',token,{version:'2026-09-14'});
const offerBody={version:'88-2026-AI-2026-09-21',documentSha256:'b21177972dbdeedbea731e826b070ff7fb148ec1f96e7892536e67e40732ce88',readConfirmed:true};
const offer=token=>call('/offer/accept',token,offerBody);

try{
 let healthy=false;for(let i=0;i<40;i++){try{if((await call('/health')).status===200){healthy=true;break}}catch{}await new Promise(r=>setTimeout(r,200))}assert.ok(healthy,'API starts');
 assert.equal((await call('/me')).status,401);assert.equal((await call('/telegram/webhook',null,{update_id:1})).status,401);
 const owner=await login(11111),user=await login(22222),other=await login(33333),referred=await login(44444,'r_22222');
 assert.equal((await call('/me/language',null,{language:'en'},'PATCH')).status,401);
 assert.equal((await call('/me/language',user,{language:'de'},'PATCH')).status,400);
 assert.equal((await call('/me/language',user,{language:'ro'},'PATCH')).status,200);
 assert.equal((await call('/me',user)).data.user.preferredLanguage,'ro','language is saved before accepting agreements');
 assert.equal((await call('/me/language',user,{language:'en'},'PATCH')).status,200);
 const returning=await login(22222);assert.equal((await call('/me',returning)).data.user.preferredLanguage,'en','language survives new sessions');
 assert.equal((await call('/me/language',user,{language:'ru'},'PATCH')).status,200);
 assert.equal((await call('/me',user)).data.user.preferredLanguage,'ru');
 const publicOffer=await call('/offer');assert.equal(publicOffer.status,200);assert.equal(publicOffer.data.version,offerBody.version);assert.equal(publicOffer.data.documentSha256,offerBody.documentSha256);assert.equal(publicOffer.data.tariffs.length,4);assert.equal(publicOffer.data.tariffs[0].dailyPercent,'1.50');assert.equal(publicOffer.data.tariffs[3].available,false);
 const beforeAgreement=await call('/me',user);assert.equal(beforeAgreement.data.agreement.accepted,false);assert.equal(beforeAgreement.data.offer.accepted,false);assert.deepEqual(beforeAgreement.data.journey.map(s=>s.state),['DONE','CURRENT','WAITING','WAITING','LOCKED']);
 assert.equal((await call('/profile/tariff',user,{nodeId:'NODE_4090'})).status,403);
 assert.equal((await call('/agreement/accept',user,{version:'outdated'})).status,400);
 for(const token of [owner,user,other,referred])assert.equal((await agreement(token)).status,201);
 assert.equal((await call('/profile/tariff',user,{nodeId:'NODE_4090'})).status,403,'offer gate follows user agreement');
 assert.equal((await call('/offer/accept',user,{...offerBody,readConfirmed:false})).status,400);
 assert.equal((await call('/offer/accept',user,{...offerBody,documentSha256:'0'.repeat(64)})).status,400);
 for(const token of [owner,user,other,referred])assert.equal((await offer(token)).status,201);
 const acceptedAgain=await offer(user);assert.equal(acceptedAgain.status,201);
 assert.equal((await call('/me',user)).data.offer.accepted,true);

 const market=await call('/v1/market');assert.equal(market.status,200);assert.equal(market.data.version,'offer-88-2026-ai');assert.equal(market.data.nodes.length,4);assert.equal(market.data.nodes[0].dailyUsdt,'0.750000');assert.equal(market.data.nodes[0].compoundPercent,'1.80');assert.equal(market.data.nodes[0].termPercent,'45.00');assert.equal(market.data.nodes[3].dailyUsdt,null);
 const enterprise=await call('/v1/market?category=ENTERPRISE&sort=price_desc');assert.equal(enterprise.data.nodes.length,2);assert.equal(enterprise.data.nodes[0].id,'NODE_H100');assert.equal((await call('/v1/market?sort=invalid')).status,400);assert.equal((await call('/v1/market/NODE_QBIT')).data.availability,'CONCEPT');assert.equal((await call('/v1/market/unknown')).status,404);
 assert.equal((await call('/v1/market/leases')).status,401);assert.deepEqual((await call('/v1/market/leases',user)).data,[]);assert.equal((await call('/v1/market/buy',null,{node_id:'NODE_4090'})).status,401);assert.equal((await call('/v1/market/buy',user,{node_id:'NODE_4090'})).status,503);
 assert.equal((await call('/profile/tariff',user,{nodeId:'NODE_QBIT'})).status,400);
 const selected=await call('/profile/tariff',user,{nodeId:'NODE_4090'});assert.equal(selected.status,201);assert.equal(selected.data.tariff.depositUsdt,'50');
 const selectedAgain=await call('/profile/tariff',user,{nodeId:'NODE_4090'});assert.equal(selectedAgain.status,201);
 const meSelected=await call('/me',user);assert.equal(meSelected.data.selectedTariff.name,'Node Alpha');assert.deepEqual(meSelected.data.journey.map(s=>s.state),['DONE','DONE','CURRENT','WAITING','LOCKED']);assert.equal(meSelected.data.balance,'0.000000');
 const refBefore=(await call('/me',user)).data.referrals;assert.equal(refBefore.total,1);assert.equal(refBefore.items[0].stage,'OFFER_ACCEPTED');assert.equal(refBefore.rewardConfigured,false);assert.ok(!JSON.stringify(refBefore).includes('44444'));
 await call('/profile/tariff',referred,{nodeId:'NODE_A100'});assert.equal((await call('/me',user)).data.referrals.items[0].stage,'TARIFF_SELECTED');

 // Separate, auditable test money: only owner can credit, ordering reserves atomically,
 // rejection refunds once, and approval creates an allocation record without a live lease.
 assert.equal((await call('/admin/users/22222/test-credit',user,{amount:'50',reason:'Testing',idempotencyKey:randomUUID()})).status,403);
 assert.equal((await call('/admin/users/22222/test-credit',owner,{amount:'1.5',reason:'Testing',idempotencyKey:randomUUID()})).status,400);
 assert.equal((await call('/test/orders',user,{idempotencyKey:randomUUID()})).status,400);
 const creditKey=randomUUID(),creditBody={amount:'100',reason:'Owner integration test',idempotencyKey:creditKey};
 assert.equal((await call('/admin/users/999888777/test-credit',owner,creditBody)).status,404,'cannot credit missing user');
 const credited=await call('/admin/users/22222/test-credit',owner,creditBody);assert.equal(credited.status,201);assert.equal(credited.data.testBalance,'100.000000');
 assert.equal((await call('/admin/users/22222/test-credit',owner,creditBody)).data.replayed,true);
 assert.equal((await call('/admin/users/22222/test-credit',owner,{...creditBody,amount:'200'})).status,400);
 assert.equal((await call('/me',user)).data.balance,'0.000000');
 const orderKey=randomUUID(),orderBody={idempotencyKey:orderKey};
 const [order,again]=await Promise.all([call('/test/orders',user,orderBody),call('/test/orders',user,orderBody)]);
 assert.equal(order.status,201);assert.equal(again.status,201);assert.equal(order.data.id,again.data.id);
 assert.equal(order.data.testPriceUsdt,'50.000000');assert.equal(order.data.paymentStatus,'TEST_CREDIT');
 assert.equal((await call('/me',user)).data.testBalance,'50.000000');
 assert.equal((await call('/test/orders',user,{idempotencyKey:randomUUID()})).status,400);
 assert.equal((await call('/profile/tariff',user,{nodeId:'NODE_A100'})).status,400);
 assert.equal((await call('/admin',owner)).data.pendingTestOrders,1);
 const reviewed=await call('/admin/requests/'+order.data.id,owner,{status:'REVIEWED'},'PATCH');assert.equal(reviewed.status,200);
 const approved=await call('/admin/requests/'+order.data.id,owner,{status:'CLOSED',decision:'ACCEPTED',closureReason:'Test allocation approved'},'PATCH');assert.equal(approved.status,200);
 assert.equal((await call('/admin/requests/'+order.data.id,owner,{status:'CLOSED',decision:'ACCEPTED',closureReason:'Test allocation approved'},'PATCH')).status,200);
 const assetMe=await call('/me',user);assert.equal(assetMe.status,200);assert.equal(assetMe.data.testAssets.length,1);assert.equal(assetMe.data.testAssets[0].status,'AWAITING_ALLOCATION');assert.equal(assetMe.data.notifications.unreadOrders,1);assert.equal(assetMe.data.activeNodes.length,0);assert.equal(assetMe.data.balance,'0.000000');
 assert.equal((await call('/test/orders/read',user,{})).status,201);assert.equal((await call('/me',user)).data.notifications.unreadOrders,0);
 assert.equal((await call('/admin/requests?payment=TEST_CREDIT',owner)).data.items[0].isTestOrder,true);
 await call('/profile/tariff',other,{nodeId:'NODE_A100'});
 assert.equal((await call('/admin/users/33333/test-credit',owner,{amount:'300',reason:'Test refund',idempotencyKey:randomUUID()})).status,201);
 const refundOrder=await call('/test/orders',other,{idempotencyKey:randomUUID()});assert.equal(refundOrder.status,201);assert.equal((await call('/me',other)).data.testBalance,'0.000000');
 const refused=await call('/admin/requests/'+refundOrder.data.id,owner,{status:'CLOSED',decision:'REJECTED',closureReason:'Test rejection'},'PATCH');assert.equal(refused.status,200);assert.equal((await call('/me',other)).data.testBalance,'300.000000');
 assert.equal((await call('/admin/requests/'+refundOrder.data.id,owner,{status:'CLOSED',decision:'REJECTED',closureReason:'Test rejection'},'PATCH')).status,200);
 assert.equal((await call('/me',other)).data.testBalance,'300.000000');assert.equal((await call('/me',other)).data.testAssets.length,0);
 assert.equal((await call('/withdrawals',other,{})).status,503);

 const fixture=new pg.Client({connectionString:process.env.DATABASE_URL});await fixture.connect();
 await fixture.query('INSERT INTO "LedgerEntry"(id,"userId","amountMicros",kind,"sourceId") VALUES ($1,$2,$3,$4,$5)',[randomUUID(),'22222','12000000','DEPOSIT_CONFIRMED','ci-deposit-'+randomUUID()]);
 await fixture.end();

 assert.equal((await call('/admin',user)).status,403);const adminSummary=await call('/admin',owner);assert.equal(adminSummary.status,200);assert.equal(adminSummary.data.confirmedDeposits,'12.000000');
 assert.equal((await call('/admin/users',user)).status,403);assert.equal((await call('/admin/users/not-an-id',owner)).status,400);
 const users=await call('/admin/users?q=22222',owner);assert.equal(users.status,200);assert.equal(users.data.total,1);assert.equal(users.data.items[0].invitedCount,1);assert.equal(users.data.items[0].deposited,'12.000000');assert.equal(users.data.items[0].balance,'12.000000');
 const userDetails=await call('/admin/users/22222',owner);assert.equal(userDetails.status,200);assert.equal(userDetails.data.statistics.invitedCount,1);assert.equal(userDetails.data.referrals.total,1);assert.equal(userDetails.data.invited[0].id,'44444');assert.equal(userDetails.data.statistics.deposited,'12.000000');assert.equal(userDetails.data.selectedTariff.name,'Node Alpha');
 const body={nodeId:'NODE_4090',idempotencyKey:randomUUID()};const [a,b]=await Promise.all([call('/requests',user,body),call('/requests',user,body)]);assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.data.id,b.data.id);assert.equal(a.data.profile,'MANAGED');
 assert.equal((await call('/requests',user,{...body,idempotencyKey:randomUUID()})).status,400);
 const pendingRequest=await call('/admin/requests?payment=WAITING',owner);assert.equal(pendingRequest.status,200);assert.equal(pendingRequest.data.items[0].paymentStatus,'WAITING');assert.equal(pendingRequest.data.items[0].equipment.name,'Node Alpha');assert.equal(pendingRequest.data.items[0].user.id,'22222');
 assert.equal((await call('/admin/requests?payment=INVALID',owner)).status,400);
 assert.equal((await call('/admin/requests/'+a.data.id,user,{status:'CLOSED'},'PATCH')).status,403);
 assert.equal((await call('/admin/requests/'+a.data.id,owner,{status:'CLOSED',decision:'ACCEPTED',closureReason:'Согласовано оператором'},'PATCH')).status,200);
 assert.equal((await call('/admin/requests/'+a.data.id,owner,{status:'REVIEWED'},'PATCH')).status,400);
 for(const path of ['/admin/users','/admin/requests','/admin/tickets','/admin/audit']){assert.equal((await call(path)).status,401);assert.equal((await call(path,user)).status,403);assert.equal((await call(path,owner)).status,200)}
 assert.equal((await call('/admin/tickets?status=INVALID',owner)).status,400);assert.equal((await call('/admin/audit?page=-1',owner)).status,400);
 const browser=await call('/auth/browser/start',null,{});assert.equal(browser.status,201);assert.match(browser.data.url,/^https:\/\/t.me\/aethermind_ci_bot\?start=login_/);assert.equal((await call('/auth/browser/poll',null,{id:browser.data.id,secret:browser.data.secret})).data.status,'PENDING');assert.equal((await call('/auth/browser/poll',null,{id:browser.data.id,secret:'0'.repeat(64)})).data.status,'EXPIRED');
 assert.equal((await call('/telegram/webhook',null,{update_id:9876,callback_query:{data:'bl:y:'+browser.data.id}})).status,401);
 assert.equal((await call('/support',user,{message:'hello',category:'INVALID'})).status,400);const ticket=await call('/support',user,{message:'Need help with access',subject:'Access issue',category:'COMPLAINT'});assert.equal(ticket.status,201);
 const userThread=await call('/support/'+ticket.data.id,user);assert.equal(userThread.status,200);assert.equal(userThread.data.messages.length,1);assert.equal(userThread.data.messages[0].authorType,'USER');
 const ownerTickets=await call('/admin/tickets',owner);assert.equal(ownerTickets.data.items[0].ownerUnread,true);assert.equal(ownerTickets.data.items[0].messages[0].body,'Need help with access');
 assert.equal((await call('/admin/tickets/'+ticket.data.id,other)).status,403);assert.equal((await call('/admin/tickets/'+ticket.data.id+'/messages',other,{message:'Not allowed'})).status,403);assert.equal((await call('/admin/tickets/'+ticket.data.id,owner,{status:'CLOSED'},'PATCH')).status,400);
 assert.equal((await call('/admin/tickets/'+ticket.data.id+'/read',owner,{})).status,201);assert.equal((await call('/admin/tickets/'+ticket.data.id+'/messages',owner,{message:'We received your request'})).status,201);
 const afterReply=await call('/me',user);assert.equal(afterReply.data.notifications.unreadSupport,1);assert.equal(afterReply.data.tickets[0].messages[0].body,'We received your request');
 assert.equal((await call('/support/'+ticket.data.id+'/read',user,{})).status,201);assert.equal((await call('/me',user)).data.notifications.unreadSupport,0);
 assert.equal((await call('/support/'+ticket.data.id+'/messages',user,{message:'Additional information'})).status,201);assert.equal((await call('/admin/tickets',owner)).data.items[0].ownerUnread,true);
 assert.equal((await call('/admin/tickets/'+ticket.data.id,owner,{status:'IN_PROGRESS'},'PATCH')).status,200);assert.equal((await call('/admin/tickets/'+ticket.data.id,owner,{status:'CLOSED'},'PATCH')).status,200);assert.equal((await call('/support/'+ticket.data.id+'/messages',user,{message:'Too late'})).status,400);
 const closedThread=await call('/support/'+ticket.data.id,user);assert.equal(closedThread.data.status,'CLOSED');assert.deepEqual(closedThread.data.messages.map(message=>message.authorType),['USER','OWNER','USER']);
 const burst=await Promise.all(Array.from({length:7},()=>call('/support',other,{message:'Concurrent ticket test'})));assert.equal(burst.filter(r=>r.status===201).length,5);assert.equal(burst.filter(r=>r.status===400).length,2);
 assert.equal((await call('/payments',user,{})).status,503);assert.equal((await call('/withdrawals',user,{})).status,503);assert.equal((await call('/me',user)).data.balance,'12.000000');
 // TON deposit APIs stay closed to public users until the owner performs a real Mainnet smoke test.
 for(const path of ['/v1/wallet','/v1/wallet/transactions','/v1/deposits','/v1/admin/deposits','/v1/admin/deposits/unmatched','/v1/ton/health'])assert.equal((await call(path)).status,401);
 assert.equal((await call('/v1/admin/deposits',user)).status,403);
 assert.equal((await call('/v1/wallet',user)).data.balance,'12.000000');
 assert.equal((await call('/v1/deposits',user,{asset:'USDT',network:'TON',amount:'50'})).status,503);
 assert.equal((await call('/v1/deposits',owner,{asset:'USDT',network:'TON',amount:'50'})).status,503,'no provider key in CI');
 const challenge=await call('/v1/ton/proof/payload',user,{});assert.equal(challenge.status,201);assert.equal(challenge.data.payload.length,64);
 assert.equal((await call('/v1/ton/proof/verify',user,{network:'-3',address:'invalid',proof:{payload:challenge.data.payload}})).status,400);
 assert.equal((await call('/v1/deposits/'+randomUUID(),user)).status,404);
 const {PrismaClient}=await import('@prisma/client');const {PrismaPg}=await import('@prisma/adapter-pg');
 const {applyNotification}=await import('../backend/dist/deposits/watcher.js');
 const tonDb=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:2})});
 try{
  const now=Math.floor(Date.now()/1000),invoiceId='dep_'+randomUUID().replaceAll('-','').slice(0,32);
  const sender='0:'+'a'.repeat(64),recipient='0:11c6c1ab1ed7a4b510a9032e3f4afa1c020fe5a5bd19f4e6278c89270afa9082';
  const master=(await import('@ton/ton')).Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs').toRawString();
  const config=(await import('../backend/dist/ton/config.js')).tonConfig();
  const newDeposit=await tonDb.tonDeposit.create({data:{invoiceId,userId:'22222',senderAddress:sender,recipientAddress:config.treasury.toRawString(),jettonMaster:master,requestedMicros:50000000n,queryId:'42',expiresAt:new Date(Date.now()+1200000)}});
  const note={txHash:'a'.repeat(64),traceId:null,time:now,sender,amount:50000000n,invoiceId,queryId:'42'};
  assert.equal(await applyNotification(tonDb,{...note,sender:'0:'+'b'.repeat(64)}),'UNMATCHED','other wallet cannot claim invoice');
  assert.equal((await call('/v1/deposits/'+newDeposit.id,user)).data.status,'PENDING');
  assert.equal(await applyNotification(tonDb,note),'CREDITED');
  for(let i=0;i<10;i++)assert.equal(await applyNotification(tonDb,note),'ALREADY_CREDITED');
  const settled=(await call('/v1/deposits/'+newDeposit.id,user)).data;assert.equal(settled.status,'CREDITED');assert.equal(settled.amount,'50.000000');
  assert.equal((await call('/v1/wallet',user)).data.balance,'62.000000');
  assert.equal((await call('/me',user)).data.journey[2].state,'DONE');
  assert.equal((await call('/me',user)).data.testBalance,'50.000000');
  assert.equal((await call('/v1/deposits/'+newDeposit.id,other)).status,404);
  assert.equal((await call('/v1/admin/deposits',owner)).data.items[0].status,'CREDITED');
  assert.equal((await call('/v1/admin/deposits/unmatched',owner)).data.total,1);
  const rows=await tonDb.walletLedger.findMany({where:{depositId:newDeposit.id}});assert.equal(rows.length,1);assert.equal(rows[0].balanceBefore,12000000n);assert.equal(rows[0].balanceAfter,62000000n);
  const replayInvoice=await tonDb.tonDeposit.create({data:{invoiceId:'dep_'+randomUUID().replaceAll('-','').slice(0,32),userId:'22222',senderAddress:sender,recipientAddress:config.treasury.toRawString(),jettonMaster:master,requestedMicros:50000000n,queryId:'42',expiresAt:new Date(Date.now()+1200000)}});
  assert.equal(await applyNotification(tonDb,{...note,invoiceId:replayInvoice.invoiceId}),'UNMATCHED','one chain transaction cannot fund a different invoice');
  assert.equal((await tonDb.tonDeposit.findUniqueOrThrow({where:{id:replayInvoice.id}})).status,'PENDING');
  const wrongAmount=await tonDb.tonDeposit.create({data:{invoiceId:'dep_'+randomUUID().replaceAll('-','').slice(0,32),userId:'22222',senderAddress:sender,recipientAddress:config.treasury.toRawString(),jettonMaster:master,requestedMicros:50000000n,queryId:'43',expiresAt:new Date(Date.now()+1200000)}});
  assert.equal(await applyNotification(tonDb,{...note,invoiceId:wrongAmount.invoiceId,txHash:'b'.repeat(64),queryId:'43',amount:1000000n}),'MANUAL_REVIEW');
  assert.equal((await call('/v1/wallet',user)).data.balance,'62.000000');
  const late=await tonDb.tonDeposit.create({data:{invoiceId:'dep_'+randomUUID().replaceAll('-','').slice(0,32),userId:'22222',senderAddress:sender,recipientAddress:config.treasury.toRawString(),jettonMaster:master,requestedMicros:50000000n,queryId:'44',expiresAt:new Date(Date.now()-300000)}});
  assert.equal(await applyNotification(tonDb,{...note,invoiceId:late.invoiceId,txHash:'c'.repeat(64),queryId:'44'}),'MANUAL_REVIEW');
  assert.equal((await call('/v1/wallet',user)).data.balance,'62.000000');
 }finally{await tonDb.$disconnect()}
 console.log('Integration checks passed: previous tests plus TON wallet access, proof challenge, amount mismatch, foreign sender, deposit ledger and tenfold idempotent replay.');
}finally{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await done;clearTimeout(timer)}}
