import 'dotenv/config';
import {Client} from 'pg';
import {createDb} from './db-utc.js';
import {financialFlag} from './financial-offer.js';
import {settleLease} from './financial-cycle.js';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export async function runEpochSettlement(connectionString:string,now=new Date()){
 if(!financialFlag('ACCRUAL'))return {paused:true,processed:0};
 const lock=new Client({connectionString,options:'-c TimeZone=UTC'});
 const db=createDb(connectionString,3);
 let acquired=false;
 try{
  await lock.connect();
  const result=await lock.query<{acquired:boolean}>('SELECT pg_try_advisory_lock($1) AS acquired',[2026092901]);
  acquired=Boolean(result.rows[0]?.acquired);
  if(!acquired)return {paused:false,locked:true,processed:0};
  let last:string|undefined,processed=0;
  for(;;){
   // PostgreSQL UUID columns reject an empty string, even on an empty table.
   // The first page has no cursor; later pages use the last real lease UUID.
   const rows=await db.userLease.findMany({where:{status:'ACTIVE',offerVersion:{not:null},...(last?{id:{gt:last}}:{})},orderBy:{id:'asc'},take:100,select:{id:true}});
   if(!rows.length)break;
   for(const row of rows){await settleLease(db,row.id,now);processed++;}
   last=rows.at(-1)!.id;
  }
  return {paused:false,processed};
 }finally{
  if(acquired)await lock.query('SELECT pg_advisory_unlock($1)',[2026092901]).catch(()=>{});
  await Promise.allSettled([db.$disconnect(),lock.end()]);
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
 const url=process.env.DATABASE_URL;
 if(!url)throw Error('Missing DATABASE_URL');
 runEpochSettlement(url).then(result=>{process.stdout.write(JSON.stringify(result)+'\n')}).catch((error:unknown)=>{
  // Log the database/framework code only; error messages can contain credentials.
  const value=(error as {code?:unknown})?.code;
  const code=typeof value==='string'&&/^[A-Za-z0-9_]{2,20}$/.test(value)?value:'UNKNOWN';
  process.stderr.write(`Epoch settlement failed (${code}); inspect database and audit state.\n`);process.exitCode=1;
 });
}
