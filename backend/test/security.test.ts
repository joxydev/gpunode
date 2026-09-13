import {test} from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {telegramIdentity,signSession,sessionIdentity,microsToDecimal,validWebhook} from '../src/security.js';
const token='123456:TEST_TOKEN_NOT_A_REAL_CREDENTIAL';const secret='x'.repeat(64);const now=1800000000;
function signed(extra:Record<string,string>={}){const p=new URLSearchParams({auth_date:String(now),user:JSON.stringify({id:12345,first_name:'Tester'}),...extra});const key=createHmac('sha256','WebAppData').update(token).digest();p.set('hash',createHmac('sha256',key).update([...p.entries()].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));return p.toString();}
test('valid Telegram identity and referral',()=>assert.deepEqual(telegramIdentity(signed({start_param:'r_12346'}),token,now),{id:'12345',name:'Tester',username:undefined,referrer:'12346'}));
test('tampered signature rejected',()=>assert.throws(()=>telegramIdentity(signed().replace('Tester','Attacker'),token,now)));
test('old and future timestamps rejected',()=>{assert.throws(()=>telegramIdentity(signed(),token,now+301));assert.throws(()=>telegramIdentity(signed(),token,now-31));});
test('duplicate keys rejected',()=>assert.throws(()=>telegramIdentity(signed()+'&auth_date='+now,token,now)));
test('wrong bot rejected',()=>assert.throws(()=>telegramIdentity(signed(),token+'x',now)));
test('session valid, expired and tampered',()=>{const s=signSession('12345',secret,now);assert.equal(sessionIdentity('Bearer '+s,secret,now),'12345');assert.throws(()=>sessionIdentity(s,secret,now+21600));assert.throws(()=>sessionIdentity(s+'x',secret,now));});
test('money remains exact beyond JS safe integers',()=>{assert.equal(microsToDecimal(123456789012345678n),'123456789012.345678');assert.equal(microsToDecimal(-1n),'-0.000001');});
test('webhook secret must be configured and exact',()=>{assert.equal(validWebhook('secret','secret'),true);assert.equal(validWebhook('x','secret'),false);assert.equal(validWebhook(undefined,'secret'),false);assert.equal(validWebhook('',undefined),false);});
