import {randomUUID} from 'node:crypto';
export type Query = <T = Record<string, any>>(sql:string, params?:unknown[]) => Promise<T[]>;
export type CatalogRow = {id:string;name:string;category:string;tier_level:number;chip:string;precision_label:string;workload:string;price_usdt:string;daily_yield_percent:string;compound_boost_percent:string|null;tflops_power:number;total_supply:number;available_supply:number;supply_known:boolean;contract_days:number;max_per_user:number;image_url:string;is_active:boolean;is_experimental:boolean;contract_reference:string|null};
export const MARKET_VERSION='offer-88-2026-ai';
// This release accepts requests. Contract approval, provisioning and settlement ship separately.
export const PURCHASES_ENABLED=false;
export function scaled(value:string,places:number):bigint {
  if(!/^\d+(\.\d+)?$/.test(value))throw Error('Invalid decimal');
  const [whole,fraction='']=value.split('.');
  if(fraction.length>places)throw Error('Decimal precision exceeded');
  return BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0'));
}
export function fixed(value:bigint,places:number):string {
  if(value<0n)return '-'+fixed(-value,places);
  const digits=value.toString().padStart(places+1,'0');
  return digits.slice(0,-places)+'.'+digits.slice(-places);
}
export function present(row:CatalogRow) {
  const priceCents=scaled(String(row.price_usdt),2),rateBps=scaled(String(row.daily_yield_percent),2);
  const dailyMicros=priceCents*rateBps;
  const availability=row.is_experimental?'CONCEPT':'AVAILABLE';
  return {id:row.id,name:row.name,category:row.category,tier:row.tier_level,chip:row.chip,precision:row.precision_label,workload:row.workload,
    priceUsdt:fixed(priceCents,2),dailyPercent:row.is_experimental?null:fixed(rateBps,2),dailyUsdt:row.is_experimental?null:fixed(dailyMicros,6),
    compoundPercent:row.is_experimental||row.compound_boost_percent===null?null:fixed(scaled(String(row.compound_boost_percent),2),2),
    termPercent:row.is_experimental?null:fixed(rateBps*BigInt(row.contract_days),2),
    termYieldUsdt:row.is_experimental?null:fixed(dailyMicros*BigInt(row.contract_days),6),tflops:row.tflops_power,contractDays:row.contract_days,
    availability,image:row.image_url,experimental:row.is_experimental,termsStatus:'PUBLIC_OFFER',canBuy:false,canSelect:!row.is_experimental};
}
export function catalogueQuery(category='ALL',sort='tier_asc') {
  if(!['ALL','CONSUMER','ENTERPRISE','QUANTUM'].includes(category))throw Error('Некорректная категория.');
  const sorts:Record<string,string>={tier_asc:'tier_level ASC',tier_desc:'tier_level DESC',price_asc:'price_usdt ASC',price_desc:'price_usdt DESC',yield_desc:'daily_yield_percent DESC',yield_asc:'daily_yield_percent ASC',apr_desc:'daily_yield_percent DESC',apr_asc:'daily_yield_percent ASC'};
  if(!Object.hasOwn(sorts,sort))throw Error('Некорректная сортировка.');
  return {sql:`SELECT * FROM gpu_catalog WHERE is_active = TRUE ${category==='ALL'?'':'AND category = $1'} ORDER BY ${sorts[sort]}, id ASC`,params:category==='ALL'?[]:[category]};
}
export class MarketError extends Error {constructor(public code:string){super(code);}}
// Prepared ACID core, NOT exposed for paid transactions by this release. All future money
// writers must lock the same User row; LedgerEntry is the sole source of balance.
export async function reserveLease(query:Query,userId:string,nodeId:string,key:string,enabled:boolean) {
  if(!enabled)throw new MarketError('CONTRACTS_NOT_CONNECTED');
  const users=await query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',[userId]);
  if(!users.length)throw new MarketError('USER_NOT_FOUND');
  const prior=await query('SELECT * FROM user_leases WHERE user_id=$1 AND idempotency_key=$2::uuid',[userId,key]);
  if(prior.length){if(prior[0].node_id!==nodeId)throw new MarketError('IDEMPOTENCY_CONFLICT');return prior[0];}
  const [row]=await query<CatalogRow>('SELECT * FROM gpu_catalog WHERE id=$1 FOR UPDATE',[nodeId]);
  if(!row?.is_active||row.is_experimental||!row.contract_reference||!row.supply_known)throw new MarketError('CONTRACTS_NOT_CONNECTED');
  if(row.available_supply<1)throw new MarketError('SOLD_OUT');
  const [count]=await query('SELECT count(*)::int AS n FROM user_leases WHERE user_id=$1 AND node_id=$2 AND status IN (\'PROVISIONING\',\'ACTIVE\',\'OVERCLOCKED\') AND expires_at > CURRENT_TIMESTAMP',[userId,nodeId]);
  if(count.n>=row.max_per_user)throw new MarketError('USER_LIMIT');
  const [balance]=await query('SELECT COALESCE(sum("amountMicros"),0)::text AS amount FROM "LedgerEntry" WHERE "userId"=$1',[userId]);
  const price=scaled(String(row.price_usdt),2)*10000n;
  if(BigInt(balance.amount)<price)throw new MarketError('INSUFFICIENT_BALANCE');
  const id=randomUUID();
  // Snapshot only; no earnings are posted and provisioning is not called ACTIVE.
  const daily4=(scaled(String(row.price_usdt),2)*scaled(String(row.daily_yield_percent),2)+50n)/100n;
  await query('UPDATE gpu_catalog SET available_supply=available_supply-1 WHERE id=$1 RETURNING id',[nodeId]);
  const [lease]=await query(`INSERT INTO user_leases (id,user_id,node_id,purchase_price,daily_yield_usdt,contract_reference,idempotency_key,expires_at)
    VALUES ($1::uuid,$2,$3,$4::numeric,$5::numeric,$6,$7::uuid,CURRENT_TIMESTAMP + $8::int * INTERVAL '1 day') RETURNING *`,[id,userId,nodeId,row.price_usdt,fixed(daily4,4),row.contract_reference,key,row.contract_days]);
  await query('INSERT INTO "LedgerEntry" (id,"userId","amountMicros",kind,"sourceId") VALUES ($1,$2,$3::bigint,\'PURCHASE\',$4) RETURNING id',[randomUUID(),userId,(-price).toString(),'lease:'+id]);
  await query('INSERT INTO "Audit" (id,"actorId",action,"targetId") VALUES ($1,$2,\'LEASE_RESERVED\',$3) RETURNING id',[randomUUID(),userId,id]);
  return lease;
}
