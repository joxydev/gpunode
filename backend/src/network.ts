import {BadRequestException,ConflictException} from '@nestjs/common';
import type {PrismaClient,Prisma} from '@prisma/client';
import {createHmac,randomUUID} from 'node:crypto';
import {notify} from './production.js';
import {choices,DAY,feeWindow,hash,portion,proRata,rates,structurePeriod,validateDecisions,type Decisions} from './network-rules.js';
type DB=PrismaClient|Prisma.TransactionClient;
type Source={id:string;kind:'ACT'|'DAILY'|'FEE';user_id:string;lease_id:string;amount_micros:bigint;occurred_at:Date;scope:string;snapshot:Record<string,unknown>};
type Policy={version:string;decisions:Decisions};
type Lease={id:string;user_id:string;node_id:string;principal_micros:bigint;activated_at:Date;epoch_ends_at:Date;early_unbonded_at:Date|null;completed_at:Date|null;created_at:Date};
type Planned={id:string;recipient:string;source:string;kind:string;line:number;scope:string;base:string;bps:number;amount:string;remainderBefore:number;remainderAfter:number;at:string;reason?:string;details?:unknown};
const query=<T>(db:DB,sql:string,...values:unknown[])=>db.$queryRawUnsafe<T[]>(sql,...values);
export const serial=(v:unknown):any=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
const iso=(d:Date)=>new Date(d).toISOString();
export function publication(){const text=process.env.NETWORK_PUBLISHED_AT;const p=text?new Date(text):null;if(!p||!Number.isFinite(p.getTime())||p>new Date())throw Error('NETWORK_PUBLICATION_REQUIRED');return p}
export function effective(){return new Date(publication().getTime()+7*DAY)}
export async function policy(db:DB):Promise<Policy|null>{const rows=await query<{version:string;decisions:Decisions}>(db,'SELECT version,decisions FROM network_policy ORDER BY created_at DESC,version DESC LIMIT 1');return rows[0]||null}
const policyVersion=(p:Policy|null)=>p?.version||'RULES_PENDING';
async function primary(db:DB,l:Lease,p:Policy){
 if(p.decisions.primary==='EACH_CONTRACT')return l.principal_micros;
 if(p.decisions.primary==='FIRST_PER_TARIFF'){const rows=await query<{id:string}>(db,'SELECT id FROM user_leases WHERE user_id=$1 AND node_id=$2 AND activated_at IS NOT NULL ORDER BY activated_at,id LIMIT 1',l.user_id,l.node_id);return rows[0]?.id===l.id?l.principal_micros:0n;}
 // FIFO provenance uses actual, matched TON credits; refunds/profit/admin/rewards are separate lots.
 const entries=await query<{id:string;kind:string;sourceId:string;amountMicros:bigint;external:boolean}>(db,`SELECT e.*,EXISTS(SELECT 1 FROM deposits d WHERE d.user_id=e."userId" AND d.status='CREDITED' AND d.network='TON' AND d.asset='USDT' AND d.tx_hash IS NOT NULL AND (e."sourceId"='ton:'||d.tx_hash OR e."sourceId"='deposit:'||d.id OR e."sourceId"=d.id::text OR e."sourceId"=d.tx_hash)) external FROM "LedgerEntry" e WHERE e."userId"=$1 AND (e."createdAt" AT TIME ZONE 'UTC')<=$2 ORDER BY e."createdAt",e.id`,l.user_id,l.created_at);
 const lots:{amount:bigint;external:boolean}[]=[];
 for(const e of entries){if(e.amountMicros>0n)lots.push({amount:e.amountMicros,external:e.external&&['TON_DEPOSIT','DEPOSIT_CONFIRMED','CRYPTO_DEPOSIT_CONFIRMED'].includes(e.kind)});else{let debit=-e.amountMicros,external=0n;while(debit>0n&&lots.length){const lot=lots[0],used=lot.amount<debit?lot.amount:debit;if(lot.external)external+=used;lot.amount-=used;debit-=used;if(lot.amount===0n)lots.shift()}if(e.sourceId===`lease:${l.id}:purchase`)return debit>0n?0n:external;}}
 return 0n;
}
async function metrics(db:DB,user:string,at:Date,p:Policy,exclude?:string){
 const leases=await query<Lease>(db,`SELECT l.* FROM user_leases l WHERE (l.user_id=$1 OR EXISTS(SELECT 1 FROM network_paths n WHERE n.ancestor=$1 AND n.descendant=l.user_id AND n.joined_at<=$2)) AND l.activated_at<=$2 AND l.principal_micros IS NOT NULL ORDER BY l.activated_at,l.id`,user,at);
 let own=0n,team=0n;
 for(const l of leases){if(l.id===exclude)continue;const active=l.epoch_ends_at>at&&(!l.early_unbonded_at||l.early_unbonded_at>at)&&(!l.completed_at||l.completed_at>at);if(l.user_id===user){if(active)own+=l.principal_micros;}else if(p.decisions.team==='LIFETIME'||active)team+=await primary(db,l,p);}
 return {own,team,rank:own<50000000n?0:team>=50000000000n?3:team>=15000000000n?2:team>=3000000000n?1:0};
}
export async function qualification(db:DB,user:string,at:Date,p:Policy,exclude?:string){
 const m=await metrics(db,user,at,p,exclude);if(p.decisions.retention==='RETAIN'){
  // Reconstruct attained rights on the event timeline, including late worker catch-up.
  const dates=await query<{at:Date}>(db,`SELECT DISTINCT l.activated_at AS at FROM user_leases l WHERE (l.user_id=$1 OR EXISTS(SELECT 1 FROM network_paths n WHERE n.ancestor=$1 AND n.descendant=l.user_id)) AND l.activated_at<=$2 AND l.id<>coalesce($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid) ORDER BY at`,user,at,exclude||null);
  for(const d of dates){const previous=await metrics(db,user,d.at,p,exclude);m.rank=Math.max(m.rank,previous.rank)}
 }return m;
}
async function plans(db:DB,s:Source,p:Policy|null,scope:string,carry:Map<string,number>,ranks:Set<string>):Promise<{items:Planned[];waiting:string[]}>{
 const items:Planned[]=[],waiting:string[]=[];if(s.kind==='FEE')return {items,waiting};
 const paths=await query<{ancestor:string;depth:number}>(db,'SELECT ancestor,depth FROM network_paths WHERE descendant=$1 AND joined_at<=$2 ORDER BY depth',s.user_id,s.occurred_at);
 for(const path of paths){const line=path.depth;
  const when=new Date(s.occurred_at),exclude=s.kind==='ACT'&&p?.decisions.trigger==='BEFORE'?s.lease_id:undefined;
  let q:{own:bigint;team:bigint;rank:number}|null=null;
  if(p)q=await qualification(db,path.ancestor,when,p,exclude);
  if(line<=3){if(line>1&&!p){waiting.push('QUALIFICATION_POLICY_REQUIRED');}else if(line===1||q!.rank>=1){
   const bps=rates[s.kind][line-1],key=`${scope}:${path.ancestor}:${s.kind}:${line}`,before=carry.get(key)??Number((await query<{remainder:number}>(db,'SELECT remainder FROM network_carry WHERE recipient=$1 AND kind=$2 AND line=$3 AND scope=$4',path.ancestor,s.kind,line,scope))[0]?.remainder||0);
   const a=portion(s.amount_micros,bps,before);carry.set(key,a.remainder);
   items.push({id:`${scope}:${s.id}:${path.ancestor}:${s.kind}:${line}`,recipient:path.ancestor,source:s.id,kind:s.kind,line,scope,base:s.amount_micros.toString(),bps,amount:a.amount.toString(),remainderBefore:before,remainderAfter:a.remainder,at:iso(s.occurred_at)});
  }}
  if(q&&p)for(const rank of [1,2,3])if(q.rank>=rank){const key=`${path.ancestor}:${rank}`;if(ranks.has(key))continue;ranks.add(key);const amount=rank===2?500000000n:rank===3?2500000000n:0n;
   items.push({id:`RANK:${path.ancestor}:${rank}`,recipient:path.ancestor,source:s.id,kind:'RANK',line:rank,scope,base:'0',bps:0,amount:amount.toString(),remainderBefore:0,remainderAfter:0,at:iso(s.occurred_at),details:{rank}});
  }
 }
 return {items,waiting:[...new Set(waiting)]};
}
async function pay(tx:DB,item:Planned,version:string){
 if((await query<{id:string}>(tx,'SELECT id FROM network_reward WHERE id=$1',item.id)).length)return false;
 await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',item.recipient);
 if(item.kind==='RANK'){
  const insert=await query<{user_id:string}>(tx,'INSERT INTO network_rank VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING user_id',item.recipient,item.line,new Date(item.at),item.source);if(!insert.length)return false;
 }
 let ledgerId:string|null=null;const amount=BigInt(item.amount);
 if(amount>0n){const entry=await tx.ledgerEntry.create({data:{userId:item.recipient,kind:'AMB_'+item.kind,sourceId:'amb:'+item.id,amountMicros:amount}});ledgerId=entry.id;}
 await tx.$executeRawUnsafe(`INSERT INTO network_reward(id,recipient,source_id,kind,line,scope,policy_version,base_micros,rate_bps,amount_micros,remainder_before,remainder_after,occurred_at,status,ledger_id,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PAID',$14,$15::jsonb)`,item.id,item.recipient,item.source,item.kind,item.line,item.scope,version,BigInt(item.base),item.bps,amount,item.remainderBefore,item.remainderAfter,new Date(item.at),ledgerId,JSON.stringify(item.details||{}));
 if(item.kind==='ACT'||item.kind==='DAILY')await tx.$executeRawUnsafe('INSERT INTO network_carry VALUES($1,$2,$3,$4,$5) ON CONFLICT(recipient,kind,line,scope) DO UPDATE SET remainder=EXCLUDED.remainder',item.recipient,item.kind,item.line,item.scope,item.remainderAfter);
 if(amount>0n)await notify(tx,{userId:item.recipient,type:'AMBASSADOR_REWARD',title:'AI Ambassador Network',message:`${amount/1000000n}.${(amount%1000000n).toString().padStart(6,'0')} USDT`,referenceType:'AMBASSADOR',referenceId:item.id.slice(0,100),dedupeKey:'amb:'+hash(item.id)});
 return true;
}
export async function backfillReport(db:DB){
 const p=await policy(db),pub=publication(),sources=await query<Source>(db,'SELECT * FROM network_source WHERE scope=\'HISTORY\' OR occurred_at<$1 ORDER BY occurred_at,id',pub);
 const paid=new Set((await query<{id:string}>(db,'SELECT id FROM network_reward')).map(x=>x.id)),rankset=new Set((await query<{user_id:string;rank:number}>(db,'SELECT user_id,rank FROM network_rank')).map(x=>x.user_id+':'+x.rank));
 const carry=new Map<string,number>(),items:Planned[]=[],waiting=new Set<string>();
 for(const s of sources){const result=await plans(db,s,p,'HISTORY',carry,rankset);result.waiting.forEach(x=>waiting.add(x));items.push(...result.items.filter(x=>!paid.has(x.id)));}
 const unknown=await query<{id:string}>(db,'SELECT id FROM user_leases WHERE activated_at IS NOT NULL AND principal_micros IS NULL LIMIT 100');if(unknown.length)waiting.add('LEGACY_TERMS_REVIEW');if(!p)waiting.add('POLICY_DECISIONS_REQUIRED');
 const report={schema:1,policyVersion:policyVersion(p),publication:iso(pub),financialWrites:0,ready:waiting.size===0,waiting:[...waiting],events:sources.length,legacy:unknown.map(x=>x.id),items,totalMicros:items.reduce((n,v)=>n+BigInt(v.amount),0n).toString()};return {...report,reportHash:hash(report)};
}
export async function approveBackfill(db:PrismaClient,actor:string,reportHash:string,reason:string){return db.$transaction(async tx=>{
 await tx.$queryRawUnsafe('SELECT 1::int FROM pg_advisory_xact_lock(2026101042)');const report=await backfillReport(tx);
 if(!report.ready||report.reportHash!==reportHash)throw new ConflictException('BACKFILL_REPORT_CHANGED_OR_NOT_READY');
 await tx.$executeRawUnsafe('INSERT INTO network_backfill VALUES($1,$2::jsonb,$3,$4,now()) ON CONFLICT DO NOTHING',reportHash,JSON.stringify(report),actor,reason);
 await tx.audit.create({data:{actorId:actor,action:'AMB_BACKFILL_APPROVED',targetId:reportHash}});return {approved:true,reportHash};
},{timeout:120000})}
export async function approvePolicy(db:PrismaClient,actor:string,body:Record<string,unknown>){let d:Decisions;try{d=validateDecisions(body.decisions)}catch(e){throw new BadRequestException((e as Error).message)}const reason=String(body.reason||'').trim();if(reason.length<10||reason.length>1000)throw new BadRequestException('POLICY_REASON_REQUIRED');const version=hash({d,actor,at:new Date().toISOString()});
 return db.$transaction(async tx=>{await tx.$executeRawUnsafe('INSERT INTO network_policy(version,decisions,actor_id,reason) VALUES($1,$2::jsonb,$3,$4)',version,JSON.stringify(d),actor,reason);await tx.audit.create({data:{actorId:actor,action:'AMB_POLICY_APPROVED',targetId:version}});return {version,decisions:d}})
}
async function watermark(db:DB,end:Date){const rows=await query<{id:string}>(db,`SELECT id FROM user_leases WHERE offer_version IS NOT NULL AND activated_at<$1 AND settled_days<least(contract_days,greatest(0,floor(extract(epoch FROM (least($1::timestamptz,coalesce(early_unbonded_at,$1::timestamptz),epoch_ends_at)-activated_at))/86400)::int)) LIMIT 1`,end);return !rows.length}
async function periodPlan(db:DB,kind:'STRUCT'|'POOL',start:Date,end:Date,p:Policy){
 const plans:Planned[]=[],qualifications:{user:string;own:string;team:string;rank:number}[]=[],sources=await query<Source>(db,'SELECT * FROM network_source WHERE kind=$1 AND occurred_at>=$2 AND occurred_at<$3 ORDER BY occurred_at,id',kind==='STRUCT'?'ACT':'FEE',start,end);
 const users=await query<{id:string}>(db,'SELECT DISTINCT ancestor id FROM network_paths ORDER BY ancestor');const qmap=new Map<string,number>(),weights:{id:string;weight:bigint}[]=[];
 for(const u of users){const q=await qualification(db,u.id,end,p);qmap.set(u.id,q.rank);qualifications.push({user:u.id,own:q.own.toString(),team:q.team.toString(),rank:q.rank});if(q.rank>=3)weights.push({id:u.id,weight:q.team})}
 const report:{source:string;base:string;excluded:string|null;recipient:string|null}[]=[];const bases=new Map<string,bigint>();let waiting=false;
 if(kind==='STRUCT')for(const s of sources){const l=(await query<Lease>(db,'SELECT * FROM user_leases WHERE id=$1::uuid',s.lease_id))[0];let excluded:string|null=null;
  if(!l||l.epoch_ends_at<=end||l.early_unbonded_at&&l.early_unbonded_at<=end||l.completed_at&&l.completed_at<=end)excluded='NOT_ACTIVE_AT_END';const base=l?await primary(db,l,p):0n;if(!base&&!excluded)excluded='NOT_PRIMARY';
  const paths=await query<{ancestor:string;depth:number}>(db,'SELECT ancestor,depth FROM network_paths WHERE descendant=$1 AND joined_at<=$2 ORDER BY depth',s.user_id,s.occurred_at);const leaders=paths.filter(x=>(qmap.get(x.ancestor)||0)>=2),nearest=leaders[0];
  if(nearest?.depth===1&&leaders.length>1&&p.decisions.firstLine==='LITERAL_REVIEW'){waiting=true;excluded='FIRST_LINE_RULE_REVIEW'}
  const recipient=!excluded?nearest?.ancestor||null:null;if(recipient)bases.set(recipient,(bases.get(recipient)||0n)+base);report.push({source:s.id,base:base.toString(),excluded,recipient});
 }
 let pool=0n,undistributed=0n;
 if(kind==='POOL'){const fees=sources.reduce((n,v)=>n+v.amount_micros,0n);pool=fees*2n/100n;const distribution=proRata(pool,weights);undistributed=distribution.undistributed;for(const item of distribution.items)plans.push({id:`POOL:${iso(end)}:${item.id}`,recipient:item.id,source:`POOL:${iso(end)}`,kind:'POOL',line:0,scope:'LIVE',base:item.weight.toString(),bps:200,amount:item.amount.toString(),remainderBefore:0,remainderAfter:0,at:iso(end),details:{weight:item.weight.toString(),totalWeight:weights.reduce((n,v)=>n+v.weight,0n).toString(),pool:pool.toString()}});
 }else for(const [recipient,base] of [...bases.entries()].sort((a,b)=>a[0].localeCompare(b[0])))plans.push({id:`STRUCT:${iso(start)}:${recipient}`,recipient,source:`STRUCT:${iso(start)}`,kind:'STRUCT',line:0,scope:'LIVE',base:base.toString(),bps:100,amount:(base/100n).toString(),remainderBefore:0,remainderAfter:0,at:iso(end)});
 return {schema:1,kind,start:iso(start),end:iso(end),policyVersion:p.version,qualifications,sources:serial(sources),report,plans,pool:pool.toString(),undistributed:undistributed.toString(),waiting};
}
async function settlePeriod(db:PrismaClient,id:string,kind:'STRUCT'|'POOL',start:Date,end:Date,p:Policy|null){
 await db.$executeRawUnsafe(`INSERT INTO network_period(id,kind,start_at,end_at,snapshot_at,deadline,status) VALUES($1,$2,$3,$4,$4,$5,'WAITING') ON CONFLICT DO NOTHING`,id,kind,start,end,kind==='POOL'?new Date(end.getTime()+2*DAY):null);
 if(!p)return;if(!await watermark(db,end)){await db.$executeRawUnsafe("UPDATE network_period SET last_error='WAITING_EPOCH_WATERMARK' WHERE id=$1 AND plan IS NULL",id);return;}
 let row=(await query<{status:string;plan:any;policy_version:string}>(db,'SELECT * FROM network_period WHERE id=$1',id))[0];if(['CLOSED','UNDISTRIBUTED'].includes(row.status))return;
 if(!row.plan){const plan=await db.$transaction(tx=>periodPlan(tx,kind,start,end,p),{isolationLevel:'RepeatableRead',timeout:120000});if(plan.waiting){await db.$executeRawUnsafe("UPDATE network_period SET last_error='FIRST_LINE_RULE_REVIEW' WHERE id=$1",id);return;}
  await db.$executeRawUnsafe("UPDATE network_period SET plan=$2::jsonb,policy_version=$3,frozen_at=now(),status='PARTIAL',undistributed_micros=$4,last_error=NULL WHERE id=$1 AND plan IS NULL",id,JSON.stringify(plan),p.version,BigInt(plan.undistributed));row=(await query<any>(db,'SELECT * FROM network_period WHERE id=$1',id))[0];
 }
 let processed=0;for(const item of row.plan.plans as Planned[]){if(processed>=100)break;await db.$transaction(async tx=>{if(await pay(tx,item,row.policy_version)){await tx.$executeRawUnsafe('UPDATE network_period SET paid_micros=paid_micros+$2 WHERE id=$1',id,BigInt(item.amount));processed++;}},{timeout:30000})}
 const done=await query<{n:bigint}>(db,'SELECT count(*) n FROM network_reward WHERE source_id=$1',kind==='POOL'?`POOL:${iso(end)}`:`STRUCT:${iso(start)}`);
 if(Number(done[0].n)==row.plan.plans.length)await db.$executeRawUnsafe('UPDATE network_period SET status=$2 WHERE id=$1',id,BigInt(row.plan.undistributed)>0n?'UNDISTRIBUTED':'CLOSED');
}
export async function runNetwork(db:PrismaClient,now=new Date()){
 const pub=publication(),p=await policy(db),version=policyVersion(p);
 const rows=await query<Source>(db,`SELECT s.* FROM network_source s LEFT JOIN network_source_processing x ON x.source_id=s.id WHERE s.scope<>'HISTORY' AND s.occurred_at>=$1 AND (x.source_id IS NULL OR x.policy_version<>$2) ORDER BY s.occurred_at,s.id LIMIT 100`,pub,version);let processed=0;
 for(const s of rows)await db.$transaction(async tx=>{
  const paid=new Set((await query<{id:string}>(tx,'SELECT id FROM network_reward WHERE source_id=$1',s.id)).map(x=>x.id));const ranks=new Set((await query<{user_id:string;rank:number}>(tx,'SELECT user_id,rank FROM network_rank')).map(x=>x.user_id+':'+x.rank));
  const result=await plans(tx,s,p,'LIVE',new Map(),ranks);for(const item of result.items.sort((a,b)=>a.recipient.localeCompare(b.recipient)))if(!paid.has(item.id))await pay(tx,item,version);
  await tx.$executeRawUnsafe('INSERT INTO network_source_processing(source_id,policy_version,status,last_error) VALUES($1,$2,$3,$4) ON CONFLICT(source_id) DO UPDATE SET policy_version=EXCLUDED.policy_version,status=EXCLUDED.status,last_error=EXCLUDED.last_error,processed_at=now()',s.id,version,result.waiting.length?'WAITING_RULES':'DONE',result.waiting.join(',')||null);processed++;
 },{timeout:120000});
 const approved=await query<{report_hash:string;report:{policyVersion:string;items:Planned[]}}>(db,'SELECT * FROM network_backfill ORDER BY approved_at');let historical=0;
 for(const a of approved)for(const item of a.report.items){if(historical>=100)break;await db.$transaction(async tx=>{if(await pay(tx,item,a.report.policyVersion))historical++},{timeout:30000})}
 const anchor=effective();let periods=0;
 for(let end=new Date(anchor.getTime()+30*DAY);end<=now&&periods<12;end=new Date(end.getTime()+30*DAY),periods++)await settlePeriod(db,`STRUCT:${iso(new Date(end.getTime()-30*DAY))}`,'STRUCT',new Date(end.getTime()-30*DAY),end,p);
 let s=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+1,1));periods=0;
 for(;s<=now&&periods<12;s=new Date(Date.UTC(s.getUTCFullYear(),s.getUTCMonth()+1,1)),periods++){const win=feeWindow(s);await settlePeriod(db,`POOL:${iso(s)}`,'POOL',win.start,win.end,p);}
 const risk=await query<{id:string;deadline:Date}>(db,"SELECT id,deadline FROM network_period WHERE kind='POOL' AND status NOT IN('CLOSED','UNDISTRIBUTED') AND deadline<=$1",new Date(now.getTime()+DAY));
 for(const item of risk)await db.$transaction(tx=>notify(tx,{userId:process.env.OWNER_TELEGRAM_ID!,type:'AMB_SNAPSHOT_ALERT',title:'AI Ambassador Network',message:'Расчёт требует внимания: '+item.id,referenceType:'AMBASSADOR',referenceId:item.id,dedupeKey:'amb:deadline:'+item.id}));
 return {processed,historical,policyVersion:version,waitingOwnerDecisions:!p,deadlineAlerts:risk.length};
}
const page=(v:unknown)=>{const n=Number(v||0);if(!Number.isSafeInteger(n)||n<0||n>1000000)throw new BadRequestException('INVALID_PAGE');return n};
export async function summary(db:DB,user:string){const p=await policy(db),now=new Date(),q=p?await qualification(db,user,now,p):null;
 const lines=await query<{line:number;total:bigint;active:bigint}>(db,`SELECT n.depth line,count(*) total,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM user_leases l WHERE l.user_id=n.descendant AND l.activated_at<=now() AND l.epoch_ends_at>now() AND l.early_unbonded_at IS NULL AND l.completed_at IS NULL)) active FROM network_paths n WHERE n.ancestor=$1 AND n.depth<=3 GROUP BY n.depth ORDER BY n.depth`,user);
 const income=await query<{kind:string;total:bigint;period:bigint}>(db,`SELECT kind,sum(amount_micros) total,sum(amount_micros) FILTER(WHERE occurred_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') period FROM network_reward WHERE recipient=$1 AND status='PAID' GROUP BY kind`,user);
 const counts=await query<{n:bigint}>(db,'SELECT count(*) n FROM network_paths WHERE ancestor=$1',user),pending=await query<{n:bigint}>(db,"SELECT count(*) n FROM network_source_processing x JOIN network_source s ON s.id=x.source_id JOIN network_paths n ON n.descendant=s.user_id WHERE n.ancestor=$1 AND x.status<>'DONE'",user);
 const start=effective(),current=structurePeriod(start,now),nextPool=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
 return serial({title:'AI Ambassador Network',policyVersion:policyVersion(p),waitingOwnerDecisions:!p,publication:iso(publication()),effectiveAt:iso(start),rank:q?.rank??null,qualification:q?{ownMicros:q.own,teamMicros:q.team,ownRequiredMicros:'50000000',thresholds:['3000000000','15000000000','50000000000']}:null,lines,total:counts[0].n,income,pendingEvents:pending[0].n,structure:{start:current.start,end:current.end},nextPool,withdrawal:{minimumUsdt:'10',platformFeePercent:'0',network:'TON',networkGasApplies:true},rates});
}
export async function partners(db:DB,user:string,params:{page?:unknown;line?:unknown;state?:unknown}){
 const n=page(params.page),line=Number(params.line||0);if(!Number.isInteger(line)||line<0||line>3)throw new BadRequestException('INVALID_LINE');const state=String(params.state||'ALL');if(!['ALL','ACTIVE','FUNDED','REGISTERED'].includes(state))throw new BadRequestException('INVALID_STATE');
 const condition=`n.ancestor=$1 AND ($2::int=0 OR n.depth=$2) AND ($3='ALL' OR $3='ACTIVE' AND EXISTS(SELECT 1 FROM user_leases l WHERE l.user_id=u.id AND l.activated_at<=now() AND l.epoch_ends_at>now() AND l.early_unbonded_at IS NULL AND l.completed_at IS NULL) OR $3='FUNDED' AND EXISTS(SELECT 1 FROM deposits d WHERE d.user_id=u.id AND d.status='CREDITED') OR $3='REGISTERED')`;
 const rows=await query<any>(db,`SELECT u.id,u."createdAt",n.depth,EXISTS(SELECT 1 FROM deposits d WHERE d.user_id=u.id AND d.status='CREDITED') funded,EXISTS(SELECT 1 FROM user_leases l WHERE l.user_id=u.id AND l.activated_at<=now() AND l.epoch_ends_at>now() AND l.early_unbonded_at IS NULL AND l.completed_at IS NULL) active,EXISTS(SELECT 1 FROM lease_accruals a JOIN user_leases l ON l.id=a.lease_id WHERE l.user_id=u.id) profit,coalesce((SELECT sum(r.amount_micros) FROM network_reward r JOIN network_source s ON s.id=r.source_id WHERE r.recipient=$1 AND s.user_id=u.id),0)::bigint brought FROM network_paths n JOIN "User" u ON u.id=n.descendant WHERE ${condition} ORDER BY u."createdAt" DESC,u.id LIMIT 25 OFFSET $4`,user,line,state,n*25);
 const count=(await query<{n:bigint}>(db,`SELECT count(*) n FROM network_paths n JOIN "User" u ON u.id=n.descendant WHERE ${condition}`,user,line,state))[0].n;
 return serial({page:n,total:count,hasMore:BigInt((n+1)*25)<count,items:rows.map(r=>({id:createHmac('sha256',process.env.SESSION_SECRET!).update('network:'+r.id).digest('hex').slice(0,12),joinedAt:r.createdAt,line:r.depth,funded:r.funded,active:r.active,profit:r.profit,broughtMicros:r.brought}))});
}
export async function rewards(db:DB,user:string,pn:unknown,kind='ALL'){const n=page(pn);if(!['ALL','ACT','DAILY','RANK','STRUCT','POOL'].includes(kind))throw new BadRequestException('INVALID_KIND');const items=await query<any>(db,'SELECT id,kind,line,base_micros,amount_micros,occurred_at,status,scope,policy_version FROM network_reward WHERE recipient=$1 AND ($2=\'ALL\' OR kind=$2) ORDER BY occurred_at DESC,id DESC LIMIT 25 OFFSET $3',user,kind,n*25);const total=(await query<{n:bigint}>(db,'SELECT count(*) n FROM network_reward WHERE recipient=$1 AND ($2=\'ALL\' OR kind=$2)',user,kind))[0].n;return serial({items,page:n,total,hasMore:BigInt((n+1)*25)<total})}
export async function snapshots(db:DB,user:string,pn:unknown){const n=page(pn);const items=await query<any>(db,`SELECT p.id,p.kind,p.start_at,p.end_at,p.deadline,p.status,p.last_error,p.paid_micros,p.undistributed_micros,r.amount_micros FROM network_period p LEFT JOIN network_reward r ON r.source_id=p.id AND r.recipient=$1 ORDER BY p.end_at DESC,p.id LIMIT 25 OFFSET $2`,user,n*25);return serial({items,page:n,hasMore:items.length===25})}
export async function preview(db:PrismaClient,user:string){const p=await policy(db);if(!p)return {status:'WAITING_RULES',reason:'POLICY_DECISIONS_REQUIRED'};const a=effective();if(new Date()<a)return {status:'NOT_EFFECTIVE',effectiveAt:iso(a)};const period=structurePeriod(a,new Date());const plan=await db.$transaction(tx=>periodPlan(tx,'STRUCT',period.start,period.end,p),{isolationLevel:'RepeatableRead',timeout:120000});const related=plan.report.filter(r=>r.recipient===user||plan.qualifications.some(q=>q.user===user)&&r.excluded);return {status:'ESTIMATE',start:plan.start,end:plan.end,confirmed:false,baseMicros:plan.plans.find(x=>x.recipient===user)?.base||'0',amountMicros:plan.plans.find(x=>x.recipient===user)?.amount||'0',exclusions:related.filter(x=>x.excluded).map(({excluded,base})=>({reason:excluded,baseMicros:base})),waiting:plan.waiting}}
export async function ownerOverview(db:DB){return serial({policy:await policy(db),choices,periods:await query<any>(db,'SELECT id,kind,start_at,end_at,deadline,status,paid_micros,undistributed_micros,last_error FROM network_period ORDER BY end_at DESC LIMIT 25'),processing:await query<any>(db,'SELECT status,count(*) total FROM network_source_processing GROUP BY status'),related:await query<any>(db,'SELECT network,address,count(DISTINCT user_id) accounts FROM wallet_binding_history WHERE verified GROUP BY network,address HAVING count(DISTINCT user_id)>1 LIMIT 25'),decisions:await query<any>(db,'SELECT * FROM network_policy ORDER BY created_at DESC LIMIT 25'),reviews:await query<any>(db,'SELECT * FROM network_review ORDER BY created_at DESC LIMIT 25')})}
export async function periodDetail(db:DB,id:string){const row=(await query<any>(db,'SELECT * FROM network_period WHERE id=$1',id))[0];return serial(row||null)}
export async function review(db:PrismaClient,actor:string,body:Record<string,unknown>){const reason=String(body.reason||'').trim(),user=String(body.userId||''),decision=String(body.decision||'');if(reason.length<10||reason.length>1000||!['RELATED_ACCOUNT_CONFIRMED','NO_ABUSE_FOUND','NEEDS_EVIDENCE'].includes(decision)||!await db.user.findUnique({where:{id:user}}))throw new BadRequestException('INVALID_REVIEW');await db.$executeRawUnsafe('INSERT INTO network_review(actor_id,user_id,decision,reason) VALUES($1,$2,$3,$4)',actor,user,decision,reason);return {recorded:true,financialHold:false}}
