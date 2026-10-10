import {Pool} from 'pg';
import {createDb} from './db-utc.js';
import {runNetwork} from './network.js';
const url=process.env.DATABASE_URL;if(!url)throw Error('DATABASE_URL_REQUIRED');
const guard=new Pool({connectionString:url,max:1,options:'-c TimeZone=UTC'}),client=await guard.connect();let locked=false;
const db=createDb(url,4);
try{const result=await client.query('SELECT pg_try_advisory_lock(2026101041) locked');locked=result.rows[0].locked;if(!locked)console.log(JSON.stringify({locked:true,processed:0}));else {const result=await runNetwork(db);console.log(JSON.stringify(result));if(result.failures.length)process.exitCode=1;}}
catch(error){console.error('AMB_WORKER_FAILED: '+((error as Error).message.match(/^[A-Z_]+/)?.[0]||'CHECK_PROTECTED_REPORT'));process.exitCode=1}
finally{if(locked)await client.query('SELECT pg_advisory_unlock(2026101041)');client.release();await guard.end();await db.$disconnect()}
