// Real webhook and browser login against an isolated DB; Telegram transport is mocked.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
if(process.env.CI_INTEGRATION!=='1'||new URL(process.env.DATABASE_URL).pathname!=='/aethermind_ci')throw Error('Refusing non-CI database');
const port=process.env.CI_PORT||'3198',base='http://127.0.0.1:'+port+'/api',calls=[];
const child=spawn(process.execPath,['--import','./ops/bot-ci-transport.mjs','backend/dist/main.js'],{stdio:['ignore','inherit','inherit','ipc'],env:{...process.env,PORT:port}});
child.on('message',message=>{if(message.kind==='telegram')calls.push(message);});
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
let update=610000;
async function request(path,body,secret){const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(secret?{'x-telegram-bot-api-secret-token':secret}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
function message(text,id=910203,language='ru'){return {update_id:++update,message:{chat:{id,type:'private'},from:{id,first_name:'<CI & user>',language_code:language},text}};}
async function webhook(payload){const result=await request('/telegram/webhook',payload,process.env.BOT_WEBHOOK_SECRET);assert.equal(result.status,201);return result;}
async function delivered(count){for(let i=0;i<50&&calls.length<count;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls.length,count);return calls.at(-1);}
try{
 await db.connect();
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}if(child.exitCode!==null)throw Error('CI API stopped');await new Promise(resolve=>setTimeout(resolve,100));}
 await db.query(`INSERT INTO "User"(id,name,"preferredLanguage") VALUES ('910201','Referrer',NULL),('910202','Romanian preference','ro')`);
 const start=message('/start@aethermind_ci_bot r_910201');
 assert.equal((await request('/telegram/webhook',start,'WRONG')).status,401);assert.equal(calls.length,0);
 await webhook(start);let sent=await delivered(1);
 assert.equal(sent.method,'sendPhoto');assert.equal(sent.payload.photo.sha256,createHash('sha256').update(readFileSync('frontend/public/assets/bot/welcome.jpg')).digest('hex'));
 assert.equal(sent.payload.photo.type,'image/jpeg');assert.equal(sent.payload.parse_mode,'HTML');assert.match(sent.payload.caption,/Добро пожаловать/);assert.match(sent.payload.caption,/&lt;CI &amp; user&gt;/);
 assert.equal((await db.query('SELECT "referrerId" FROM "Invite" WHERE "telegramId"=$1',['910203'])).rows[0].referrerId,'910201');
 await webhook(start);assert.equal(calls.length,1);
 await webhook(message('/start',910202,'en'));sent=await delivered(2);assert.match(sent.payload.caption,/Bun venit/);assert.equal(sent.payload.photo,'CI_WELCOME_PHOTO');
 await webhook(message('/start',910204,'en'));sent=await delivered(3);assert.match(sent.payload.caption,/Welcome/);
 for(const [command,heading] of [['/help','Навигация'],['/terms','Условия'],['/support','Поддержка'],['/paysupport','Поддержка']]){
  const expected=calls.length+1;await webhook(message(command));sent=await delivered(expected);assert.equal(sent.method,'sendMessage');assert.match(sent.payload.text,new RegExp(heading));assert.equal(sent.payload.parse_mode,'HTML');assert.equal(sent.payload.reply_markup.inline_keyboard[0][0].web_app.url,process.env.PUBLIC_URL+'/');
 }
 const count=calls.length;await webhook(message('/unknown'));
 const group=message('/start');group.message.chat.type='group';await webhook(group);assert.equal(calls.length,count);
 const browser=await request('/auth/browser/start',{});assert.equal(browser.status,201);
 await webhook(message('/start login_'+browser.data.id));sent=await delivered(count+1);
 assert.equal(sent.method,'sendMessage');assert.equal(sent.payload.parse_mode,'HTML');assert.equal(sent.payload.link_preview_options.is_disabled,true);assert.match(sent.payload.text,/<code>[A-Z0-9-]+<\/code>/);
 assert.equal(sent.payload.reply_markup.inline_keyboard[0][0].callback_data,'bl:y:'+browser.data.id);
 await webhook({update_id:++update,callback_query:{id:'ci-confirm',data:'bl:y:'+browser.data.id,from:{id:910203,first_name:'CI',language_code:'ru'},message:{chat:{id:910203,type:'private'}}}});
 sent=await delivered(count+2);assert.equal(sent.method,'answerCallbackQuery');assert.match(sent.payload.text,/подтверждён/);
 const poll=await request('/auth/browser/poll',{id:browser.data.id,secret:browser.data.secret});assert.equal(poll.data.status,'APPROVED');assert.ok(poll.data.token);
 await webhook(message('/start login_'+browser.data.id));sent=await delivered(count+3);assert.match(sent.payload.text,/Запрос входа истёк/);assert.equal(sent.payload.reply_markup,undefined);
 console.log('BOT HTTP INTEGRATION PASSED: image upload/cache, RU/EN/RO, preference, all commands, referral, duplicate, private guard and browser confirmation; no real Telegram sends.');
}finally{await db.end();child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});}
