import {writeFileSync} from 'node:fs';
import {createDb} from '../backend/dist/db-utc.js';
const path=process.argv[2];if(!path?.startsWith('/'))throw Error('PROTECTED_REPORT_REQUIRED');
const db=createDb(process.env.DATABASE_URL,1);
try{const report=await db.$transaction(async tx=>{
 await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
 const duplicates=await tx.$queryRawUnsafe(`SELECT user_id,node_id,count(*) count,array_agg(id::text ORDER BY created_at,id) leases FROM user_leases WHERE status IN ('PROVISIONING','ACTIVE','OVERCLOCKED','EXPIRED') GROUP BY user_id,node_id HAVING count(*)>1`);
 const legacy=await tx.$queryRawUnsafe(`SELECT "userId", "nodeId",count(*) count FROM "RentalRequest" WHERE "isTestOrder"=false AND lease_id IS NULL AND status IN ('REQUESTED','REVIEWED') GROUP BY "userId","nodeId" HAVING count(*)>1`);
 const mixed=await tx.$queryRawUnsafe(`SELECT r.id request,l.id lease FROM "RentalRequest" r JOIN user_leases l ON l.user_id=r."userId" AND l.node_id=r."nodeId" WHERE r."isTestOrder"=false AND r.lease_id IS NULL AND r.status IN ('REQUESTED','REVIEWED') AND l.status IN ('PROVISIONING','ACTIVE','OVERCLOCKED','EXPIRED')`);
 const cycles=await tx.$queryRawUnsafe(`WITH RECURSIVE t AS (SELECT id,"referrerId" parent,ARRAY[id] seen,false cycle FROM "User" UNION ALL SELECT t.id,u."referrerId",t.seen||u.id,u.id=ANY(t.seen) FROM t JOIN "User" u ON u.id=t.parent WHERE NOT t.cycle) SELECT DISTINCT id FROM t WHERE cycle`);
 return {schema:1,checkedAt:new Date().toISOString(),financialWrites:0,duplicates,legacy,mixed,cycles,ready:!duplicates.length&&!legacy.length&&!mixed.length&&!cycles.length};
 },{isolationLevel:'RepeatableRead',timeout:120000});
 writeFileSync(path,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({ready:report.ready,conflicts:report.duplicates.length+report.legacy.length+report.mixed.length+report.cycles.length,financialWrites:0}));if(!report.ready)process.exitCode=2;
}finally{await db.$disconnect()}
