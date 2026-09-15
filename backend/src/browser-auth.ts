import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Query} from './market.js';
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const validId=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
export const loginCode=(id:string)=>id.slice(0,6).toUpperCase();
export async function createBrowserLogin(q:Query,ipHash:string){
 await q('DELETE FROM browser_logins WHERE expires_at < CURRENT_TIMESTAMP RETURNING id');
 // Call inside a transaction: lock makes the per-client limit atomic.
 await q('SELECT pg_advisory_xact_lock(hashtextextended($1, 17))',[ipHash]);
 const [count]=await q('SELECT count(*)::int AS n FROM browser_logins WHERE ip_hash=$1',[ipHash]);
 if(count.n>=5)throw Error('Слишком много запросов входа. Повторите через пять минут.');
 const id=randomUUID(),secret=randomBytes(32).toString('hex');
 const [row]=await q('INSERT INTO browser_logins (id,secret_hash,ip_hash,expires_at) VALUES ($1::uuid,$2,$3,CURRENT_TIMESTAMP + INTERVAL \'5 minutes\') RETURNING expires_at',[id,hash(secret),ipHash]);
 return {id,secret,code:loginCode(id),expiresAt:row.expires_at};
}
export async function bindBrowserLogin(q:Query,id:string,telegramId:string){
 if(!validId(id))return false;
 const rows=await q(`UPDATE browser_logins SET telegram_id=$2 WHERE id=$1::uuid AND status='PENDING' AND expires_at>CURRENT_TIMESTAMP AND (telegram_id IS NULL OR telegram_id=$2) RETURNING id`,[id,telegramId]);
 return rows.length===1;
}
export async function decideBrowserLogin(q:Query,id:string,user:{id:string;name:string;username?:string},approve:boolean){
 if(!validId(id)||!/^\d{1,16}$/.test(user.id))return false;
 const rows=await q(`UPDATE browser_logins SET status=$3 WHERE id=$1::uuid AND telegram_id=$2 AND status='PENDING' AND expires_at>CURRENT_TIMESTAMP RETURNING id`,[id,user.id,approve?'APPROVED':'DENIED']);
 if(!rows.length)return false;
 if(approve)await q(`INSERT INTO "User" (id,name,username) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,username=EXCLUDED.username RETURNING id`,[user.id,user.name.slice(0,128),user.username?.slice(0,64)||null]);
 return true;
}
export async function pollBrowserLogin(q:Query,id:string,secret:string){
 if(!validId(id)||!/^[0-9a-f]{64}$/.test(secret))return {status:'EXPIRED'};
 const [row]=await q('SELECT * FROM browser_logins WHERE id=$1::uuid AND secret_hash=$2 AND expires_at>CURRENT_TIMESTAMP FOR UPDATE',[id,hash(secret)]);
 if(!row||row.consumed_at)return {status:'EXPIRED'};
 if(row.status!=='APPROVED')return {status:row.status as string};
 await q('UPDATE browser_logins SET consumed_at=CURRENT_TIMESTAMP WHERE id=$1::uuid RETURNING id',[id]);
 return {status:'APPROVED',userId:row.telegram_id as string};
}
