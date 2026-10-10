import {BadRequestException,ConflictException} from '@nestjs/common';
import type {PrismaClient,Prisma} from '@prisma/client';
import {createHmac,randomUUID} from 'node:crypto';
import {notify} from './production.js';
import {choices,compareIds,DAY,feeWindow,hash,portion,proRata,rates,structurePeriod,validateDecisions,type Decisions} from './network-rules.js';
type DB=PrismaClient|Prisma.TransactionClient;
type Source={id:string;kind:'ACT'|'DAILY'|'FEE';user_id:string;lease_id:string;amount_micros:bigint;occurred_at:Date;scope:string;snapshot:Record<string,unknown>};
type Policy={version:string;decisions:Decisions};
type Lease={id:string;user_id:string;node_id:string;principal_micros:bigint;activated_at:Date;epoch_ends_at:Date;early_unbonded_at:Date|null;completed_at:Date|null;created_at:Date};
type Planned={id:string;recipient:string;source:string;kind:string;line:number;scope:string;base:string;bps:number;amount:string;remainderBefore:number;remainderAfter:number;at:string;reason?:string;details?:unknown};
const query=<T>(db:DB,sql:string,...values:unknown[])=>db.$queryRawUnsafe<T[]>(sql,...values);
export const serial=(v:unknown):any=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
const iso=(d:Date)=>new Date(d).toISOString();
export function publication(){const text=process.env.NETWORK_PUBLISHED_AT;const p=text?new Date(text):null;if(!p||!Number.isFinite(p.getTime())||p>new Date())throw Error('NETWORK_PUBLICATION_REQUIRED');return p}
export function effective(){return publication()}
export function programStarted(){const value=new Date(process.env.NETWORK_PROGRAM_STARTED_AT||publication().toISOString());if(!Number.isFinite(value.getTime())||value>publication())throw Error('NETWORK_PROGRAM_ORIGIN_INVALID');return value}
export async function policy(db:DB):Promise<Policy|null>{const rows=await query<{version:string;decisions:Decisions}>(db,'SELECT version,decisions FROM network_policy ORDER BY created_at DESC,version DESC LIMIT 1');return rows[0]||null}
const policyVersion=(p:Policy|null)=>p?.version||'RULES_PENDING';
async function qualificationLeases(db:DB,user:string,at:Date){return query<Lease>(db,`SELECT l.* FROM user_leases l WHERE (l.user_id=$1 OR EXISTS(SELECT 1 FROM network_paths n WHERE n.ancestor=$1 AND n.descendant=l.user_id AND n.joined_at<=$2)) AND l.activated_at<=$2 AND l.principal_micros IS NOT NULL ORDER BY l.activated_at,l.id`,user,at)}
async function primaryAmounts(db:DB,leases:Lease[],p:Policy){
 const amounts=new Map<string,bigint>();if(p.decisions.primary==='EACH_CONTRACT'){for(const l of leases)amounts.set(l.id,l.principal_micros);return amounts;}
 const users=[...new Set(leases.map(l=>l.user_id))];if(!users.length)return amounts;
 if(p.decisions.primary==='FIRST_PER_TARIFF'){const first=await query<Lease>(db,'SELECT DISTINCT ON(user_id,node_id) * FROM user_leases WHERE user_id=ANY($1::text[]) AND activated_at IS NOT NULL ORDER BY user_id,node_id,activated_at,id',users);const ids=new Set(first.map(l=>l.id));for(const l of leases)amounts.set(l.id,ids.has(l.id)?l.principal_micros:0n);return amounts;}
 const entries=await query<{userId:string;sourceId:string;kind:string;amountMicros:bigint;external:boolean}>(db,`SELECT e.*,EXISTS(SELECT 1 FROM deposits d WHERE d.user_id=e."userId" AND d.status='CREDITED' AND d.network='TON' AND d.asset='USDT' AND d.tx_hash IS NOT NULL AND e."sourceId"='ton-deposit:'||d.id) external FROM "LedgerEntry" e WHERE e."userId"=ANY($1::text[]) ORDER BY e."userId",e."createdAt",e.id`,users);
 const lots=new Map<string,{amount:bigint;external:boolean}[]>();for(const e of entries){const userLots=lots.get(e.userId)||[];lots.set(e.userId,userLots);if(e.amountMicros>0n)userLots.push({amount:e.amountMicros,external:e.external&&e.kind==='DEPOSIT_CONFIRMED'});else{let debit=-e.amountMicros,external=0n;while(debit>0n&&userLots.length){const lot=userLots[0],used=lot.amount<debit?lot.amount:debit;if(lot.external)external+=used;lot.amount-=used;debit-=used;if(lot.amount===0n)userLots.shift()}const id=/^lease:([0-9a-f-]{36}):purchase$/.exec(e.sourceId||'')?.[1];if(id)amounts.set(id,debit?0n:external);}}
 return amounts;
}
const rankAt=(own:bigint,team:bigint)=>own<50000000n?0:team>=50000000000n?3:team>=15000000000n?2:team>=3000000000n?1:0;
export async function qualification(db:DB,user:string,at:Date,p:Policy,exclude?:string){
 const leases=await qualificationLeases(db,user,at),amounts=await primaryAmounts(db,leases,p);return qualificationFrom(leases,amounts,user,at,p,exclude);
}
function qualificationFrom(input:Lease[],amounts:Map<string,bigint>,user:string,at:Date,p:Policy,exclude?:string){
 const leases=input.filter(l=>l.id!==exclude);let own=0n,team=0n;const events:{time:number;own:bigint;team:bigint;end:boolean}[]=[];
 for(const l of leases){const end=Math.min(l.epoch_ends_at.getTime(),l.early_unbonded_at?.getTime()||Infinity,l.completed_at?.getTime()||Infinity),active=end>at.getTime(),personal=l.user_id===user,base=amounts.get(l.id)||0n;
  if(personal&&active)own+=l.principal_micros;if(!personal&&(p.decisions.team==='LIFETIME'||active))team+=base;
  if(p.decisions.retention==='RETAIN'){events.push({time:l.activated_at.getTime(),own:personal?l.principal_micros:0n,team:personal?0n:base,end:false});if(end<=at.getTime())events.push({time:end,own:personal?-l.principal_micros:0n,team:personal||p.decisions.team==='LIFETIME'?0n:-base,end:true});}
 }
 let rank=rankAt(own,team);if(p.decisions.retention==='RETAIN'){let o=0n,t=0n;events.sort((a,b)=>a.time-b.time||Number(b.end)-Number(a.end));for(let i=0;i<events.length;){const time=events[i].time;while(i<events.length&&events[i].time===time){o+=events[i].own;t+=events[i].team;i++}rank=Math.max(rank,rankAt(o,t))}}
 return {own,team,rank};
}
async function plans(db:DB,s:Source,p:Policy|null,scope:string,carry:Map<string,number>,ranks:Set<string>):Promise<{items:Planned[];waiting:string[]}>{
 const items:Planned[]=[],waiting:string[]=[];if(s.kind==='FEE')return {items,waiting};
 const paths=await query<{ancestor:string;depth:number}>(db,'SELECT ancestor,depth FROM network_paths WHERE descendant=$1 AND joined_at<=$2 ORDER BY depth',s.user_id,s.occurred_at);paths.unshift({ancestor:s.user_id,depth:0});
 for(const path of paths){const line=path.depth;
  const when=new Date(s.occurred_at),exclude=s.kind==='ACT'&&p?.decisions.trigger==='BEFORE'?s.lease_id:undefined;
  let q:{own:bigint;team:bigint;rank:number}|null=null;
  if(p)q=await qualification(db,path.ancestor,when,p,exclude);
  if(line>=1&&line<=3){if(line>1&&!p){waiting.push('QUALIFICATION_POLICY_REQUIRED');}else if((line===1||q!.rank>=1)&&!(await query<{id:string}>(db,'SELECT id FROM network_reward WHERE id=$1',`${scope}:${s.id}:${path.ancestor}:${s.kind}:${line}`)).length){
   const bps=rates[s.kind][line-1],key=`${scope}:${path.ancestor}:${s.kind}:${line}`,before=carry.get(key)??Number((await query<{remainder:number}>(db,'SELECT remainder FROM network_carry WHERE recipient=$1 AND kind=$2 AND line=$3 AND scope=$4',path.ancestor,s.kind,line,scope))[0]?.remainder||0);
   const a=portion(s.amount_micros,bps,before);carry.set(key,a.remainder);
   items.push({id:`${scope}:${s.id}:${path.ancestor}:${s.kind}:${line}`,recipient:path.ancestor,source:s.id,kind:s.kind,line,scope,base:s.amount_micros.toString(),bps,amount:a.amount.toString(),remainderBefore:before,remainderAfter:a.remainder,at:iso(s.occurred_at)});
  }}
  if(q&&p)for(const rank of [1,2,3])if(q.rank>=rank){const key=`${path.ancestor}:${rank}`;if(ranks.has(key))continue;if(scope==='LIVE'&&(await qualification(db,path.ancestor,programStarted(),p)).rank>=rank){waiting.push('HISTORICAL_RANK_APPROVAL_REQUIRED');continue;}ranks.add(key);const amount=rank===2?500000000n:rank===3?2500000000n:0n;
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
 const p=await policy(db),pub=programStarted(),sources=await query<Source>(db,'SELECT * FROM network_source WHERE scope=\'HISTORY\' OR occurred_at<$1 ORDER BY occurred_at,id',pub);
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
 const pathsAtEnd=await query<{ancestor:string;descendant:string}>(db,'SELECT ancestor,descendant FROM network_paths WHERE joined_at<=$1 ORDER BY ancestor,descendant',end),allLeases=await query<Lease>(db,'SELECT * FROM user_leases WHERE activated_at<=$1 AND principal_micros IS NOT NULL ORDER BY activated_at,id',end),allAmounts=await primaryAmounts(db,allLeases,p);const grouped=new Map<string,Lease[]>();for(const l of allLeases){const items=grouped.get(l.user_id)||[];items.push(l);grouped.set(l.user_id,items)}const tree=new Map<string,string[]>();for(const n of pathsAtEnd){const items=tree.get(n.ancestor)||[];items.push(n.descendant);tree.set(n.ancestor,items)}
 const users=[...tree.keys()].sort(compareIds).map(id=>({id}));const qmap=new Map<string,number>(),weights:{id:string;weight:bigint}[]=[];
 for(const u of users){const q=qualificationFrom([...(grouped.get(u.id)||[]),...(tree.get(u.id)||[]).flatMap(id=>grouped.get(id)||[])],allAmounts,u.id,end,p);qmap.set(u.id,q.rank);qualifications.push({user:u.id,own:q.own.toString(),team:q.team.toString(),rank:q.rank});if(q.rank>=3)weights.push({id:u.id,weight:q.team})}
 const candidates=kind==='STRUCT'?await query<Lease>(db,'SELECT * FROM user_leases WHERE id=ANY($1::uuid[])',sources.map(s=>s.lease_id)):[],candidateMap=new Map(candidates.map(l=>[l.id,l])),primaryMap=await primaryAmounts(db,candidates,p);
 const report:{source:string;base:string;excluded:string|null;recipient:string|null;heldRecipient?:string}[]=[];const bases=new Map<string,bigint>();let waiting=false;
 if(kind==='STRUCT')for(const s of sources){const l=candidateMap.get(s.lease_id);let excluded:string|null=null;
  if(!l||l.epoch_ends_at<=end||l.early_unbonded_at&&l.early_unbonded_at<=end||l.completed_at&&l.completed_at<=end)excluded='NOT_ACTIVE_AT_END';const base=l?(primaryMap.get(l.id)||0n):0n;if(!base&&!excluded)excluded='NOT_PRIMARY';
  const paths=await query<{ancestor:string;depth:number}>(db,'SELECT ancestor,depth FROM network_paths WHERE descendant=$1 AND joined_at<=$2 ORDER BY depth',s.user_id,s.occurred_at);const leaders=paths.filter(x=>(qmap.get(x.ancestor)||0)>=2),nearest=leaders[0];
  if(!excluded&&nearest?.depth===1&&leaders.length>1&&p.decisions.firstLine==='LITERAL_REVIEW'){waiting=true;excluded='FIRST_LINE_RULE_REVIEW'}
  const recipient=!excluded?nearest?.ancestor||null:null;if(recipient)bases.set(recipient,(bases.get(recipient)||0n)+base);report.push({source:s.id,base:base.toString(),excluded,recipient,...(excluded==='FIRST_LINE_RULE_REVIEW'?{heldRecipient:nearest.ancestor}:{})});
 }
 let pool=0n,undistributed=0n;
 if(kind==='POOL'){const fees=sources.reduce((n,v)=>n+v.amount_micros,0n);pool=fees*2n/100n;const distribution=proRata(pool,weights);undistributed=distribution.undistributed;for(const item of distribution.items)plans.push({id:`POOL:${iso(end)}:${item.id}`,recipient:item.id,source:`POOL:${iso(end)}`,kind:'POOL',line:0,scope:'LIVE',base:item.weight.toString(),bps:200,amount:item.amount.toString(),remainderBefore:0,remainderAfter:0,at:iso(end),details:{weight:item.weight.toString(),totalWeight:weights.reduce((n,v)=>n+v.weight,0n).toString(),pool:pool.toString()}});
 }else for(const [recipient,base] of [...bases.entries()].sort((a,b)=>compareIds(a[0],b[0])))plans.push({id:`STRUCT:${iso(start)}:${recipient}`,recipient,source:`STRUCT:${iso(start)}`,kind:'STRUCT',line:0,scope:'LIVE',base:base.toString(),bps:100,amount:(base/100n).toString(),remainderBefore:0,remainderAfter:0,at:iso(end)});
 return {schema:1,kind,start:iso(start),end:iso(end),policyVersion:p.version,qualifications,sources:serial(sources),report,plans,pool:pool.toString(),undistributed:undistributed.toString(),waiting};
}
export async function settlePeriod(db:PrismaClient,id:string,kind:'STRUCT'|'POOL',start:Date,end:Date,p:Policy|null){
 await db.$executeRawUnsafe(`INSERT INTO network_period(id,kind,start_at,end_at,snapshot_at,deadline,status) VALUES($1,$2,$3,$4,$4,$5,'WAITING') ON CONFLICT DO NOTHING`,id,kind,start,end,kind==='POOL'?new Date(end.getTime()+2*DAY):null);
 if(!p)return;if(!await watermark(db,end)){await db.$executeRawUnsafe("UPDATE network_period SET last_error='WAITING_EPOCH_WATERMARK' WHERE id=$1 AND plan IS NULL",id);return;}
 let row=(await query<{status:string;plan:any;policy_version:string}>(db,'SELECT * FROM network_period WHERE id=$1',id))[0];if(['CLOSED','UNDISTRIBUTED'].includes(row.status))return;
 if(!row.plan){const plan=await db.$transaction(tx=>periodPlan(tx,kind,start,end,p),{isolationLevel:'RepeatableRead',timeout:120000});
  await db.$executeRawUnsafe("UPDATE network_period SET plan=$2::jsonb,policy_version=$3,frozen_at=now(),status='PARTIAL',undistributed_micros=$4,last_error=NULL WHERE id=$1 AND plan IS NULL",id,JSON.stringify(plan),p.version,BigInt(plan.undistributed));row=(await query<any>(db,'SELECT * FROM network_period WHERE id=$1',id))[0];
 }
 let resolution=(await query<{plan:Planned[];policy_version:string}>(db,'SELECT * FROM network_period_resolution WHERE period_id=$1',id))[0];
 if(row.plan.waiting&&!resolution&&p.decisions.firstLine==='FIRST_LINE_CUT'){
  const held=new Map<string,bigint>();for(const source of row.plan.report)if(source.excluded==='FIRST_LINE_RULE_REVIEW'&&source.heldRecipient)held.set(source.heldRecipient,(held.get(source.heldRecipient)||0n)+BigInt(source.base));
  const extra:Planned[]=[...held.entries()].sort((a,b)=>compareIds(a[0],b[0])).map(([recipient,base])=>{
   const previous=(row.plan.plans as Planned[]).find(item=>item.recipient===recipient),knownBase=BigInt(previous?.base||'0'),knownAmount=BigInt(previous?.amount||'0');
   return {id:`STRUCT:${iso(start)}:RESOLVED:${recipient}`,recipient,source:`STRUCT:${iso(start)}:RESOLVED`,kind:'STRUCT',line:0,scope:'LIVE',base:base.toString(),bps:100,amount:((knownBase+base)/100n-knownAmount).toString(),remainderBefore:0,remainderAfter:0,at:iso(end),details:{originalPolicy:row.policy_version,resolutionPolicy:p.version,heldSources:row.plan.report.filter((r:any)=>r.heldRecipient===recipient).map((r:any)=>r.source)}};
  });
  await db.$executeRawUnsafe('INSERT INTO network_period_resolution(period_id,policy_version,plan) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',id,p.version,JSON.stringify(extra));resolution=(await query<any>(db,'SELECT * FROM network_period_resolution WHERE period_id=$1',id))[0];
 }
 const items=(row.plan.plans as Planned[]).map(item=>({item,version:row.policy_version})).concat((resolution?.plan||[]).map(item=>({item,version:resolution.policy_version})));
 let processed=0;for(const {item,version} of items){if(processed>=100)break;await db.$transaction(async tx=>{if(await pay(tx,item,version)){await tx.$executeRawUnsafe('UPDATE network_period SET paid_micros=paid_micros+$2 WHERE id=$1',id,BigInt(item.amount));processed++;}},{timeout:30000})}
 const done=await query<{n:bigint}>(db,'SELECT count(*) n FROM network_reward WHERE id=ANY($1::text[])',items.map(({item})=>item.id));
 if(Number(done[0].n)===items.length){const waiting=row.plan.waiting&&!resolution;await db.$executeRawUnsafe('UPDATE network_period SET status=$2,last_error=$3 WHERE id=$1',id,waiting?'WAITING_REVIEW':BigInt(row.plan.undistributed)>0n?'UNDISTRIBUTED':'CLOSED',waiting?'FIRST_LINE_RULE_REVIEW':null);}
}
export async function runNetwork(db:PrismaClient,now=new Date()){
 const pub=programStarted(),p=await policy(db),version=policyVersion(p);
 const rows=await query<Source>(db,`SELECT s.* FROM network_source s LEFT JOIN network_source_processing x ON x.source_id=s.id WHERE s.scope<>'HISTORY' AND s.occurred_at>=$1 AND s.occurred_at<=$3 AND (x.source_id IS NULL OR x.policy_version<>$2 OR x.status='FAILED') ORDER BY s.occurred_at,s.id LIMIT 100`,pub,version,now);let processed=0;
 const failures:string[]=[];for(const s of rows)try{await db.$transaction(async tx=>{
  const paid=new Set((await query<{id:string}>(tx,'SELECT id FROM network_reward WHERE source_id=$1',s.id)).map(x=>x.id));const ranks=new Set((await query<{user_id:string;rank:number}>(tx,'SELECT user_id,rank FROM network_rank')).map(x=>x.user_id+':'+x.rank));
  const result=await plans(tx,s,p,'LIVE',new Map(),ranks);for(const item of result.items.sort((a,b)=>compareIds(a.recipient,b.recipient)))if(!paid.has(item.id))await pay(tx,item,version);
  await tx.$executeRawUnsafe('INSERT INTO network_source_processing(source_id,policy_version,status,last_error) VALUES($1,$2,$3,$4) ON CONFLICT(source_id) DO UPDATE SET policy_version=EXCLUDED.policy_version,status=EXCLUDED.status,last_error=EXCLUDED.last_error,processed_at=now()',s.id,version,result.waiting.length?'WAITING_RULES':'DONE',result.waiting.join(',')||null);processed++;
 },{timeout:120000});}catch{failures.push(s.id);await db.$executeRawUnsafe("INSERT INTO network_source_processing(source_id,policy_version,status,last_error) VALUES($1,$2,'FAILED','SOURCE_TRANSACTION_FAILED') ON CONFLICT(source_id) DO UPDATE SET status='FAILED',last_error='SOURCE_TRANSACTION_FAILED'",s.id,version);break;}
 const approved=await query<{report_hash:string;report:{policyVersion:string;items:Planned[]}}>(db,'SELECT * FROM network_backfill ORDER BY approved_at');let historical=0;
 for(const a of approved)for(const item of a.report.items){if(historical>=100)break;await db.$transaction(async tx=>{if(await pay(tx,item,a.report.policyVersion))historical++},{timeout:30000})}
 const anchor=effective();let periods=0;
 for(let end=new Date(anchor.getTime()+30*DAY);end<=now&&periods<12;end=new Date(end.getTime()+30*DAY)){const start=new Date(end.getTime()-30*DAY),id=`STRUCT:${iso(start)}`;if((await query<{status:string}>(db,'SELECT status FROM network_period WHERE id=$1',id)).some(r=>['CLOSED','UNDISTRIBUTED'].includes(r.status)||r.status==='WAITING_REVIEW'&&p?.decisions.firstLine==='LITERAL_REVIEW'))continue;periods++;try{await settlePeriod(db,id,'STRUCT',start,end,p)}catch{failures.push(id);await db.$executeRawUnsafe("UPDATE network_period SET last_error='PERIOD_TRANSACTION_FAILED' WHERE id=$1",id);}}
 periods=0;let s=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+1,1));
 for(;s<=now&&periods<12;s=new Date(Date.UTC(s.getUTCFullYear(),s.getUTCMonth()+1,1))){const id=`POOL:${iso(s)}`;if((await query<{status:string}>(db,'SELECT status FROM network_period WHERE id=$1',id)).some(r=>['CLOSED','UNDISTRIBUTED'].includes(r.status)))continue;periods++;const win=feeWindow(s);try{await settlePeriod(db,id,'POOL',win.start,win.end,p)}catch{failures.push(id);await db.$executeRawUnsafe("UPDATE network_period SET last_error='PERIOD_TRANSACTION_FAILED' WHERE id=$1",id);}}
 const risk=await query<{id:string;deadline:Date}>(db,"SELECT id,deadline FROM network_period WHERE kind='POOL' AND status NOT IN('CLOSED','UNDISTRIBUTED') AND deadline<=$1",new Date(now.getTime()+DAY));
 for(const item of risk)await db.$transaction(tx=>notify(tx,{userId:process.env.OWNER_TELEGRAM_ID!,type:'AMB_SNAPSHOT_ALERT',title:'AI Ambassador Network',message:'Расчёт требует внимания: '+item.id,referenceType:'AMBASSADOR',referenceId:item.id,dedupeKey:'amb:deadline:'+item.id}));
 return {processed,historical,failures,policyVersion:version,waitingOwnerDecisions:!p,deadlineAlerts:risk.length};
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
export async function preview(db:PrismaClient,user:string){const p=await policy(db);if(!p)return {status:'WAITING_RULES',reason:'POLICY_DECISIONS_REQUIRED'};const a=effective();if(new Date()<a)return {status:'NOT_EFFECTIVE',effectiveAt:iso(a)};const period=structurePeriod(a,new Date());const plan=await db.$transaction(tx=>periodPlan(tx,'STRUCT',period.start,period.end,p),{isolationLevel:'RepeatableRead',timeout:120000});const visible=new Set((await query<{id:string}>(db,'SELECT s.id FROM network_source s JOIN network_paths n ON n.descendant=s.user_id WHERE n.ancestor=$1',user)).map(x=>x.id));const related=plan.report.filter(r=>visible.has(r.source));return {status:'ESTIMATE',start:plan.start,end:plan.end,confirmed:false,baseMicros:plan.plans.find(x=>x.recipient===user)?.base||'0',amountMicros:plan.plans.find(x=>x.recipient===user)?.amount||'0',exclusions:related.filter(x=>x.excluded).map(({excluded,base})=>({reason:excluded,baseMicros:base})),waiting:plan.waiting}}
export async function ownerOverview(db:DB){return serial({policy:await policy(db),choices,periods:await query<any>(db,'SELECT id,kind,start_at,end_at,deadline,status,paid_micros,undistributed_micros,last_error FROM network_period ORDER BY end_at DESC LIMIT 25'),processing:await query<any>(db,'SELECT status,count(*) total FROM network_source_processing GROUP BY status'),errors:await query<any>(db,"SELECT source_id,status,last_error,processed_at FROM network_source_processing WHERE status<>'DONE' ORDER BY processed_at DESC LIMIT 25"),related:await query<any>(db,'SELECT network,address,count(DISTINCT user_id) accounts,array_agg(DISTINCT user_id ORDER BY user_id) users FROM wallet_binding_history WHERE verified GROUP BY network,address HAVING count(DISTINCT user_id)>1 LIMIT 25'),decisions:await query<any>(db,'SELECT * FROM network_policy ORDER BY created_at DESC LIMIT 25'),reviews:await query<any>(db,'SELECT * FROM network_review ORDER BY created_at DESC LIMIT 25')})}
export async function periodDetail(db:DB,id:string,pn:unknown=0){const row=(await query<any>(db,'SELECT * FROM network_period WHERE id=$1',id))[0];if(!row)return null;const n=page(pn),plan=row.plan;return serial({...row,plan:plan?{...plan,qualifications:plan.qualifications.slice(n*25,(n+1)*25),sources:plan.sources.slice(n*25,(n+1)*25),report:plan.report.slice(n*25,(n+1)*25),plans:plan.plans.slice(n*25,(n+1)*25),page:n,totals:{qualifications:plan.qualifications.length,sources:plan.sources.length,plans:plan.plans.length}}:null})}
export async function review(db:PrismaClient,actor:string,body:Record<string,unknown>){const reason=String(body.reason||'').trim(),user=String(body.userId||''),decision=String(body.decision||'');if(reason.length<10||reason.length>1000||!['RELATED_ACCOUNT_CONFIRMED','NO_ABUSE_FOUND','NEEDS_EVIDENCE'].includes(decision)||!await db.user.findUnique({where:{id:user}}))throw new BadRequestException('INVALID_REVIEW');await db.$executeRawUnsafe('INSERT INTO network_review(actor_id,user_id,decision,reason) VALUES($1,$2,$3,$4)',actor,user,decision,reason);return {recorded:true,financialHold:false}}
export async function retry(db:PrismaClient,actor:string,reason:string){if(reason.trim().length<10||reason.length>1000)throw new BadRequestException('RETRY_REASON_REQUIRED');return db.$transaction(async tx=>{const count=await tx.$executeRawUnsafe("UPDATE network_source_processing SET status='FAILED',last_error='OWNER_RETRY_REQUESTED' WHERE status IN('FAILED','WAITING_RULES')");await tx.audit.create({data:{actorId:actor,action:'AMB_RETRY_REQUESTED',targetId:reason}});return {queued:count,automaticWorker:true}})}
