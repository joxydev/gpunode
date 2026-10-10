import {writeFileSync} from 'node:fs';
import {createDb} from '../backend/dist/db-utc.js';
import {backfillReport} from '../backend/dist/network.js';
const output=process.argv[2];if(!output?.startsWith('/'))throw Error('ABSOLUTE_PROTECTED_REPORT_PATH_REQUIRED');
const db=createDb(process.env.DATABASE_URL,1);
try{const report=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return backfillReport(tx)},{isolationLevel:'RepeatableRead',timeout:180000});writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({reportHash:report.reportHash,ready:report.ready,events:report.events,totalMicros:report.totalMicros,financialWrites:0}));}finally{await db.$disconnect()}
