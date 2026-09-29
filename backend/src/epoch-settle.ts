import 'dotenv/config';
import {Client} from 'pg';
import {createDb} from './db-utc.js';
import {financialFlag} from './financial-offer.js';
import {settleLease} from './financial-cycle.js';

export async function runEpochSettlement(connectionString:string,now=new Date()){
 if(!financialFlag('ACCRUAL'))return {paused:true,processed:0};
 const lock=new Client({connectionString,options:'-c TimeZone=UTC'});
 await lock.connect();
 const db=createDb(connectionString,3);
 try{
  const result=await lock.query<{acquired:boolean}>('SELECT pg_try_advisory_lock($1) AS acquired',[2026092901]);
  if(!result.rows[0]?.acquired)return {paused:false,locked:true,processed:0};
  let last='',processed=0;
  for(;;){
   const rows=await db.userLease.findMany({where:{status:'ACTIVE',offerVersion:{not:null},id:{gt:last}},orderBy:{id:'asc'},take:100,select:{id:true}});
   if(!rows.length)break;
   for(const row of rows){await settleLease(db,row.id,now);processed++;}
   last=rows.at(-1)!.id;
  }
  return {paused:false,processed};
 }finally{
  await lock.query('SELECT pg_advisory_unlock($1)',[2026092901]).catch(()=>{});
  await db.$disconnect();await lock.end();
 }
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const url=process.env.DATABASE_URL;
 if(!url)throw Error('Missing DATABASE_URL');
 runEpochSettlement(url).then(result=>{process.stdout.write(JSON.stringify(result)+'\n')}).catch(()=>{process.stderr.write('Epoch settlement failed; inspect database and audit state.\n');process.exitCode=1});
}
