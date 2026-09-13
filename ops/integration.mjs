// CI only: spawns the real API against the isolated aethermind_ci PostgreSQL database.
import {spawn} from 'node:child_process';import {createHmac,randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
if(process.env.CI_INTEGRATION!=='1'||new URL(process.env.DATABASE_URL).pathname!=='/aethermind_ci')throw Error('Refusing to run integration tests against non-CI database');
const child=spawn(process.execPath,['backend/dist/main.js'],{stdio:['ignore','inherit','inherit'],env:{...process.env,PORT:'3100'}});
const base='http://127.0.0.1:3100/api';
async function call(path,token,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
async function login(id){const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'CI user'})});const key=createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();p.set('hash',createHmac('sha256',key).update([...p.entries()].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));const r=await call('/auth/telegram',null,{initData:p.toString()});assert.equal(r.status,201);return r.data.token;}
try{
 let healthy=false;for(let i=0;i<40;i++){try{if((await call('/health')).status===200){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(healthy,'API starts');
 assert.equal((await call('/me')).status,401);assert.equal((await call('/telegram/webhook',null,{update_id:1})).status,401);
 const owner=await login(11111),user=await login(22222),other=await login(33333);
 const market=await call('/v1/market');assert.equal(market.status,200);assert.equal(market.data.version,'market-v1');assert.equal(market.data.nodes.length,4);assert.equal(market.data.nodes[0].dailyUsdt,'1.750000');assert.equal(market.data.nodes[0].remainingPercent,null);
 const enterprise=await call('/v1/market?category=ENTERPRISE&sort=price_desc');assert.equal(enterprise.data.nodes.length,2);assert.equal(enterprise.data.nodes[0].id,'NODE_H100');
 assert.equal((await call('/v1/market?sort=invalid')).status,400);
 assert.equal((await call('/v1/market/NODE_QBIT')).data.availability,'CONCEPT');
 assert.equal((await call('/v1/market/unknown')).status,404);
 assert.equal((await call('/v1/market/leases')).status,401);
 assert.deepEqual((await call('/v1/market/leases',user)).data,[]);
 assert.equal((await call('/v1/market/buy',null,{node_id:'NODE_4090'})).status,401);
 assert.equal((await call('/v1/market/buy',user,{node_id:'NODE_4090'})).status,503);
 assert.equal((await call('/admin',user)).status,403);assert.equal((await call('/admin',owner)).status,200);
 const body={nodeId:'rtx4090',profile:'BALANCED',workload:'CI training request',idempotencyKey:randomUUID()};
 const [a,b]=await Promise.all([call('/requests',user,body),call('/requests',user,body)]);assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.data.id,b.data.id);
 assert.equal((await call('/me',other)).data.requests.length,0);
 assert.equal((await call('/requests',user,{...body,idempotencyKey:randomUUID()})).status,400);
 assert.equal((await call('/admin/requests/'+a.data.id,user,{status:'CLOSED'},'PATCH')).status,403);
 assert.equal((await call('/admin/requests/'+a.data.id,owner,{status:'CLOSED'},'PATCH')).status,200);
 assert.equal((await call('/requests',other,{...body,nodeId:'quantum'})).status,400);
 assert.equal((await call('/requests',other,{...body,nodeId:'NODE_QBIT',idempotencyKey:randomUUID()})).status,400);
 assert.equal((await call('/requests',other,{...body,nodeId:'NODE_H100',idempotencyKey:randomUUID()})).status,201);
 const ticket=await call('/support',user,{message:'Need help with access'});assert.equal(ticket.status,201);
 assert.equal((await call('/admin/tickets/'+ticket.data.id,owner,{reply:'We received your request'},'PATCH')).status,200);
 assert.equal((await call('/me',user)).data.tickets[0].reply,'We received your request');
 assert.equal((await call('/payments',user,{})).status,503);assert.equal((await call('/withdrawals',user,{})).status,503);assert.equal((await call('/me',user)).data.balance,'0.000000');
 console.log('Integration checks passed: auth, ownership, idempotency, workflow, support, payment gates.');
}finally{child.kill('SIGTERM');}
