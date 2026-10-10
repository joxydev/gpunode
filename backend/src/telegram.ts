import {readFileSync} from 'node:fs';
import {WELCOME_PHOTO} from './bot-presentation.js';

type TelegramResult={ok:boolean;error_code?:number;description?:string;result?:{photo?:{file_id:string}[]}};
class TelegramError extends Error {
 constructor(readonly code?:number,readonly invalidFileId=false){super('Telegram delivery unavailable');}
}
/** Upload local artwork; Telegram never needs a public image URL or host certificate. */
export class TelegramClient {
 private photoId?:string;
 constructor(private token:string,private photoPath:string,private transport:typeof fetch=fetch){}
 private async request(method:string,payload:Record<string,unknown>,upload=false){
  let body:string|FormData,headers:Record<string,string>|undefined;
  if(upload){
   const form=new FormData();
   for(const [key,value] of Object.entries(payload))if(key!=='photo')form.append(key,typeof value==='string'?value:JSON.stringify(value));
   form.append('photo',new Blob([new Uint8Array(readFileSync(this.photoPath))],{type:'image/jpeg'}),'aethermind-welcome.jpg');
   body=form;
  }else{body=JSON.stringify(payload);headers={'Content-Type':'application/json'};}
  const response=await this.transport('https://api.telegram.org/bot'+this.token+'/'+method,{method:'POST',signal:AbortSignal.timeout(10000),headers,body});
  const value=await response.json() as TelegramResult;
  if(!response.ok||!value.ok)throw new TelegramError(value.error_code,value.error_code===400&&/file (?:identifier|id)|file_id/i.test(value.description||''));
  return value.result;
 }
 async call(method:string,payload:Record<string,unknown>){
  if(method!=='sendPhoto'||payload.photo!==WELCOME_PHOTO)return this.request(method,payload);
  if(this.photoId){
   try{return await this.request(method,{...payload,photo:this.photoId});}
   catch(error){if(!(error instanceof TelegramError)||!error.invalidFileId)throw error;this.photoId=undefined;}
  }
  const result=await this.request(method,payload,true);
  const photos=result?.photo;
  this.photoId=photos?.[photos.length-1]?.file_id;
  return result;
 }
}
