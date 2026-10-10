// Disposable CI only: intercept Telegram calls, never send to real users.
import {createHash} from 'node:crypto';
if(process.env.CI_INTEGRATION!=='1'||process.env.BOT_TOKEN!=='123456:TEST_TOKEN_NOT_A_REAL_CREDENTIAL'||new URL(process.env.DATABASE_URL).pathname!=='/aethermind_ci'||!process.send)throw Error('Refusing Telegram mock outside isolated IPC CI');
const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith('https://api.telegram.org/')){
  const method=String(url).split('/').at(-1),payload={};
  if(options.body instanceof FormData){
   for(const [key,value] of options.body.entries())payload[key]=typeof value==='string'?value:{sha256:createHash('sha256').update(Buffer.from(await value.arrayBuffer())).digest('hex'),type:value.type};
   for(const key of ['chat_id','reply_markup'])if(typeof payload[key]==='string')payload[key]=JSON.parse(payload[key]);
  }else Object.assign(payload,JSON.parse(options.body));
  process.send({kind:'telegram',method,payload});
  return new Response(JSON.stringify({ok:true,result:method==='sendPhoto'?{message_id:1,photo:[{file_id:'CI_WELCOME_PHOTO'}]}:true}));
 }
 return original(url,options);
};
