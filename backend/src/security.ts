import { createHmac, timingSafeEqual } from 'node:crypto';
export type Identity = { id: string; name: string; username?: string; referrer?: string };
function equal(a:string,b:string) { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
export function validWebhook(actual:string|undefined,expected:string|undefined){return !!expected&&!!actual&&actual.length<256&&equal(actual,expected);}
export function telegramIdentity(raw:string,token:string,now=Math.floor(Date.now()/1000)):Identity {
  if (!raw || raw.length>8192) throw Error('Откройте приложение из меню бота.');
  const params=new URLSearchParams(raw);
  if (new Set(params.keys()).size!==[...params.keys()].length) throw Error('Повторяющиеся параметры входа.');
  const hash=params.get('hash') || ''; params.delete('hash');
  const data=[...params.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
  const key=createHmac('sha256','WebAppData').update(token).digest();
  const signature=createHmac('sha256',key).update(data).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(hash) || !equal(hash,signature)) throw Error('Неверная подпись Telegram.');
  const issued=Number(params.get('auth_date'));
  if (!Number.isInteger(issued) || issued>now+30 || now-issued>300) throw Error('Вход устарел. Закройте и снова откройте Mini App.');
  const user=JSON.parse(params.get('user') || '{}');
  if (!Number.isSafeInteger(user.id)||user.id<=0||typeof user.first_name!=='string') throw Error('Некорректный профиль.');
  const ref=params.get('start_param')?.match(/^r_([1-9][0-9]{0,15})$/)?.[1];
  return {id:String(user.id),name:user.first_name.slice(0,100),username:typeof user.username==='string'?user.username.slice(0,64):undefined,referrer:ref};
}
export function signSession(id:string,secret:string,now=Math.floor(Date.now()/1000)) {
  const body=Buffer.from(JSON.stringify({id,exp:now+21600})).toString('base64url');
  return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
}
export function sessionIdentity(auth:string|undefined,secret:string,now=Math.floor(Date.now()/1000)):string {
  const parts=(auth||'').replace(/^Bearer /,'').split('.');
  if(parts.length!==2||parts[0].length>512||!equal(parts[1],createHmac('sha256',secret).update(parts[0]).digest('base64url'))) throw Error('Нужен вход через Telegram.');
  const data=JSON.parse(Buffer.from(parts[0],'base64url').toString());
  if(typeof data.id!=='string'||!/^[1-9][0-9]{0,15}$/.test(data.id)||!Number.isInteger(data.exp)||data.exp<=now) throw Error('Сессия истекла. Откройте приложение заново.');
  return data.id;
}
export function microsToDecimal(value:bigint) { const sign=value<0n?'-':'';const v=value<0n?-value:value; return `${sign}${v/1000000n}.${String(v%1000000n).padStart(6,'0')}`; }
