// CI only: starts the real Nest API against an isolated aethermind_ci database.
import {spawn} from 'node:child_process';
import {createHmac,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

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

 assert.equal((await call('/admin',user)).status,403);assert.equal((await call('/admin',owner)).status,200);
 const body={nodeId:'NODE_4090',idempotencyKey:randomUUID()};const [a,b]=await Promise.all([call('/requests',user,body),call('/requests',user,body)]);assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.data.id,b.data.id);assert.equal(a.data.profile,'MANAGED');
 assert.equal((await call('/requests',user,{...body,idempotencyKey:randomUUID()})).status,400);
 assert.equal((await call('/admin/requests/'+a.data.id,user,{status:'CLOSED'},'PATCH')).status,403);
 assert.equal((await call('/admin/requests/'+a.data.id,owner,{status:'CLOSED',decision:'ACCEPTED',closureReason:'Согласовано оператором'},'PATCH')).status,200);
 assert.equal((await call('/admin/requests/'+a.data.id,owner,{status:'REVIEWED'},'PATCH')).status,400);
 for(const path of ['/admin/requests','/admin/tickets','/admin/audit']){assert.equal((await call(path)).status,401);assert.equal((await call(path,user)).status,403);assert.equal((await call(path,owner)).status,200)}
 assert.equal((await call('/admin/tickets?status=INVALID',owner)).status,400);assert.equal((await call('/admin/audit?page=-1',owner)).status,400);
 const browser=await call('/auth/browser/start',null,{});assert.equal(browser.status,201);assert.match(browser.data.url,/^https:\/\/t.me\/aethermind_ci_bot\?start=login_/);assert.equal((await call('/auth/browser/poll',null,{id:browser.data.id,secret:browser.data.secret})).data.status,'PENDING');assert.equal((await call('/auth/browser/poll',null,{id:browser.data.id,secret:'0'.repeat(64)})).data.status,'EXPIRED');
 assert.equal((await call('/telegram/webhook',null,{update_id:9876,callback_query:{data:'bl:y:'+browser.data.id}})).status,401);
 assert.equal((await call('/support',user,{message:'hello',category:'INVALID'})).status,400);const ticket=await call('/support',user,{message:'Need help with access',subject:'Access issue',category:'COMPLAINT'});assert.equal(ticket.status,201);assert.equal((await call('/admin/tickets/'+ticket.data.id,other,{reply:'Not allowed'},'PATCH')).status,403);assert.equal((await call('/admin/tickets/'+ticket.data.id,owner,{status:'CLOSED'},'PATCH')).status,400);assert.equal((await call('/admin/tickets/'+ticket.data.id,owner,{reply:'We received your request',status:'ANSWERED'},'PATCH')).status,200);assert.equal((await call('/me',user)).data.tickets[0].reply,'We received your request');
 const burst=await Promise.all(Array.from({length:7},()=>call('/support',other,{message:'Concurrent ticket test'})));assert.equal(burst.filter(r=>r.status===201).length,5);assert.equal(burst.filter(r=>r.status===400).length,2);
 assert.equal((await call('/payments',user,{})).status,503);assert.equal((await call('/withdrawals',user,{})).status,503);assert.equal((await call('/me',user)).data.balance,'0.000000');
 console.log('Integration checks passed: auth, agreements, offer hash, tariff selection, journey, referrals, owner workflow, support and payment gates.');
}finally{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await done;clearTimeout(timer)}}
