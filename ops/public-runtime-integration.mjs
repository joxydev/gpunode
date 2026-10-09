// Start the real API with public release flags on the disposable CI database.
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {signSession} from '../backend/dist/security.js';

if(process.env.CI_INTEGRATION!=='1'||new URL(process.env.DATABASE_URL).pathname!=='/aethermind_ci')
 throw Error('Public runtime suite requires isolated CI PostgreSQL');
const flags=JSON.parse(readFileSync(new URL('./public-runtime-flags.json',import.meta.url),'utf8'));
const env={...process.env,...flags,APP_COMMIT:'a'.repeat(40),TONCENTER_API_KEY:'CI_NOT_A_REAL_TON_KEY',
 PORT:process.env.CI_PORT||'3100'};
const checker='ops/public-runtime-check.mjs';
const stale=spawnSync(process.execPath,[checker],{env:{...env,ENABLE_ACCRUAL:'false'},encoding:'utf8',timeout:15000});
assert.equal(stale.status,1);assert.match(stale.stderr,/ENABLE_ACCRUAL/);
const ready=spawnSync(process.execPath,[checker],{env,encoding:'utf8',timeout:15000});
assert.equal(ready.status,0,ready.stderr);
const child=spawn(process.execPath,['backend/dist/main.js'],{env,stdio:['ignore','inherit','inherit']});
const stopped=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)});
const base=`http://127.0.0.1:${env.PORT}/api`;
const get=async(path,token)=>{
 const response=await fetch(base+path,{headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(3000)});
 assert.equal(response.status,200);return response.json();
};
try{
 let healthy=false;
 for(let i=0;i<50;i++){
  if(child.exitCode!==null)break;
  try{const health=await get('/health');assert.equal(health.commit,env.APP_COMMIT);healthy=true;break}catch{}
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 assert.ok(healthy,'Public API starts with the release environment');
 const offer=await get('/offer');
 assert.equal(offer.paymentsEnabled,true);assert.equal(offer.accrualEnabled,true);assert.equal(offer.compoundEnabled,true);
 assert.equal(offer.financialOffer.sha256,offer.documentSha256);
 const market=await get('/v1/market');
 assert.equal(market.purchasesEnabled,true);assert.ok(market.nodes.some(node=>node.canBuy&&node.availability==='AVAILABLE'));
 // Existing ordinary CI participant has accepted the agreement in integration.mjs.
 const token=signSession('22222',env.SESSION_SECRET),me=await get('/me',token);
 assert.equal(me.purchasesEnabled,true);assert.equal(me.accrualEnabled,true);assert.equal(me.paymentsEnabled,true);assert.equal(me.compoundEnabled,true);
 console.log('PUBLIC RUNTIME CI PASSED: stale flags rejected; public API offer, catalogue and ordinary profile enabled.');
}finally{
 if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
 const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')},5000);
 try{await stopped}finally{clearTimeout(timer)}
}
