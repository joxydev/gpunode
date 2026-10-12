import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {botCommand,botLanguage,botReply,browserLoginText,WELCOME_PHOTO} from '../src/bot-presentation.js';
import {TelegramClient} from '../src/telegram.js';

const photoPath=new URL('../../frontend/public/assets/bot/welcome.jpg',import.meta.url).pathname;
const plain=(text:string)=>text.replace(/<[^>]+>/g,'').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

test('all command replies fit Telegram limits and keep the same Mini App destination in three languages',()=>{
 for(const language of ['ru','en','ro'] as const)for(const command of ['/start','/help','/terms','/support','/paysupport'] as const){
  const reply=botReply(command,language,123,'https://example.invalid/','<Name & "user">');
  const text='caption' in reply.body?reply.body.caption:reply.body.text;
  assert.equal(reply.body.parse_mode,'HTML');assert.match(text!,/<b>.+<\/b>/);assert.match(text!,/\n\n/);
  assert.ok(plain(text!).length<=(command==='/start'?1024:4096));
  assert.equal(reply.body.reply_markup.inline_keyboard[0][0].web_app.url,'https://example.invalid/');
  if(command==='/start'){assert.equal(reply.method,'sendPhoto');assert.equal(reply.body.photo,WELCOME_PHOTO);assert.match(text!,/&lt;Name &amp; &quot;user&quot;&gt;/);assert.doesNotMatch(text!,/<Name/);}
  else assert.equal(reply.method,'sendMessage');
 }
 const name='😀'.repeat(1000);for(const language of ['ru','en','ro'] as const)assert.ok(plain(botReply('/start',language,123,'https://example.invalid',name).body.caption!).length<1024);
 assert.equal(botCommand('/start@aethermind_bot r_123'),'/start');assert.equal(botCommand('/paysupport'),'/paysupport');assert.equal(botCommand('/unknown'),null);
 assert.equal(botLanguage('RO-md'),'ro');assert.equal(botLanguage('en-US'),'en');assert.equal(botLanguage('fr'),'ru');
});

test('welcome keeps the name inline without interpreting replacement tokens or a dangling comma',()=>{
 const name="$&$`$' <User>";
 const caption=botReply('/start','ru',123,'https://example.invalid',name).body.caption!;
 assert.ok(plain(caption).startsWith('👋 Приветствуем, '+name+'!'));
 assert.equal((caption.match(/Ambassador Network/g)||[]).length,1);
 assert.doesNotMatch(caption,/\{name\}/);
 for(const language of ['ru','en','ro'] as const){
  const withoutName=botReply('/start',language,123,'https://example.invalid').body.caption!;
  assert.equal(botReply('/start',language,123,'https://example.invalid','   ').body.caption,withoutName);
  assert.doesNotMatch(withoutName,/, !|\{name\}/);
 }
});

test('browser confirmation keeps its code and safety instructions without HTML injection or link previews',()=>{
 for(const language of ['ru','en','ro'] as const){
  const text=browserLoginText(language,'https://example.invalid/?x=<test>&y=1','A<&123',true);
  assert.match(text,/<code>A&lt;&amp;123<\/code>/);assert.match(text,/x=&lt;test&gt;&amp;y=1/);assert.match(text,/\n\n/);
  assert.doesNotMatch(browserLoginText(language,'https://example.invalid','OLD123',false),/OLD123/);
 }
});

test('welcome uploads the bundled JPEG then reuses Telegram file_id',async()=>{
 const calls:RequestInit[]=[];
 const transport:typeof fetch=async(_url,options)=>{calls.push(options!);return new Response(JSON.stringify({ok:true,result:{photo:[{file_id:'small'},{file_id:'full'}]}}),{status:200});};
 const client=new TelegramClient('123:TEST_NOT_REAL',photoPath,transport),reply=botReply('/start','ru',123,'https://example.invalid');
 await client.call(reply.method,reply.body);await client.call(reply.method,reply.body);
 assert.ok(calls[0].body instanceof FormData);const upload=calls[0].body as FormData;
 assert.equal(upload.get('parse_mode'),'HTML');assert.equal(upload.get('caption'),reply.body.caption);
 assert.deepEqual(Buffer.from(await (upload.get('photo') as Blob).arrayBuffer()),readFileSync(photoPath));
 assert.equal(calls[0].headers,undefined);
 assert.equal(JSON.parse(calls[1].body as string).photo,'full');
});

test('invalid cached file_id is replaced by one upload, while network errors never trigger a second send',async()=>{
 const bodies:unknown[]=[];
 const transport:typeof fetch=async(_url,options)=>{
  bodies.push(options!.body);
  return bodies.length===2?new Response(JSON.stringify({ok:false,error_code:400,description:'Bad Request: wrong file identifier/HTTP URL specified'}),{status:400}):new Response(JSON.stringify({ok:true,result:{photo:[{file_id:'full'}]}}));
 };
 const client=new TelegramClient('123:TEST_NOT_REAL',photoPath,transport),reply=botReply('/start','en',123,'https://example.invalid');
 await client.call(reply.method,reply.body);await client.call(reply.method,reply.body);assert.equal(bodies.length,3);assert.ok(bodies[2] instanceof FormData);
 let attempts=0;const failing:typeof fetch=async()=>{attempts++;throw Error('timeout');};
 await assert.rejects(new TelegramClient('123:TEST_NOT_REAL',photoPath,failing).call(reply.method,reply.body));assert.equal(attempts,1);
});

test('JSON command delivery rejects both Telegram errors and failing HTTP responses',async()=>{
 const reply=botReply('/help','ru',123,'https://example.invalid');
 for(const [status,ok] of [[200,false],[503,true]] as const){
  const transport:typeof fetch=async()=>new Response(JSON.stringify({ok}),{status});
  await assert.rejects(new TelegramClient('123:TEST_NOT_REAL',photoPath,transport).call(reply.method,reply.body),/Telegram delivery unavailable/);
 }
});
