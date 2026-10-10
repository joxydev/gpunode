import {createHash} from 'node:crypto';
export const compareIds=(a:string,b:string)=>a<b?-1:a>b?1:0;
export const DAY=86400000;
export const choices={primary:['EACH_CONTRACT','FIRST_PER_TARIFF','EXTERNAL_TON_FIFO'],team:['ACTIVE','LIFETIME'],retention:['ACTIVE','RETAIN'],firstLine:['FIRST_LINE_CUT','LITERAL_REVIEW'],trigger:['BEFORE','INCLUDING']} as const;
export type Decisions={primary:typeof choices.primary[number];team:typeof choices.team[number];retention:typeof choices.retention[number];firstLine:typeof choices.firstLine[number];trigger:typeof choices.trigger[number]};
export function validateDecisions(v:unknown):Decisions{if(!v||typeof v!=='object')throw Error('POLICY_DECISIONS_REQUIRED');for(const [k,options] of Object.entries(choices))if(!options.includes((v as Record<string,never>)[k]))throw Error('POLICY_DECISIONS_REQUIRED:'+k);return v as Decisions}
export function hash(v:unknown){return createHash('sha256').update(JSON.stringify(v)).digest('hex')}
export function portion(base:bigint,bps:number,remainder=0){const n=base*BigInt(bps)+BigInt(remainder);return {amount:n/10000n,remainder:Number(n%10000n)}}
export function proRata(pool:bigint,weights:{id:string;weight:bigint}[]){
 const total=weights.reduce((n,v)=>n+v.weight,0n);if(total<=0n)return {items:[],undistributed:pool};
 const items=weights.map(v=>({...v,amount:pool*v.weight/total,remainder:pool*v.weight%total}));let left=pool-items.reduce((n,v)=>n+v.amount,0n);
 const sorted=[...items].sort((a,b)=>a.remainder===b.remainder?compareIds(a.id,b.id):a.remainder>b.remainder?-1:1);
 for(let i=0;left>0n;i++,left--)sorted[i].amount++;
 return {items:items.sort((a,b)=>compareIds(a.id,b.id)),undistributed:0n};
}
export function structurePeriod(anchor:Date,at:Date){const i=Math.max(0,Math.floor((at.getTime()-anchor.getTime())/(30*DAY)));return {start:new Date(anchor.getTime()+i*30*DAY),end:new Date(anchor.getTime()+(i+1)*30*DAY)}}
export function feeWindow(s:Date){if(s.getUTCDate()!==1||s.getUTCHours()||s.getUTCMinutes()||s.getUTCSeconds()||s.getUTCMilliseconds())throw Error('INVALID_MONTHLY_SNAPSHOT');return {start:new Date(s.getTime()-30*DAY),end:s}}
export const rates={ACT:[700,300,100],DAILY:[1000,500,200]} as const;
