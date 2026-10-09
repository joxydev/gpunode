import {accrueDay,DAY_MS,type Mode} from './epoch-rules.js';

/** Read-only projection. All amounts are integer micro-USDT; no ledger writes. */
export type ProjectionLease={id:string;status:string;mode:string|null;offerVersion:string|null;offerDocumentSha256:string|null;
 termsSnapshot:unknown;principalMicros:bigint|null;baseDailyRateBps:number|null;compoundDailyRateBps:number|null;
 contractDays:number|null;activatedAt:Date|null;epochEndsAt:Date|null;settledDays:number;accrualRemainder:number;
 baseAccruedMicros:bigint;compoundPrincipalMicros:bigint|null;compoundProfitMicros:bigint};
export type LiveAccrual={schemaVersion:1;snapshotKey:string;serverNow:string;validSnapshot:boolean;mode:Mode|null;
 state:'ACTIVE'|'SYNCING'|'PAUSED'|'PROVISIONING'|'COMPLETED'|'EARLY_UNBONDED'|'CANCELLED'|'UNAVAILABLE';
 periodIndex:number|null;periodStart:string|null;periodEnd:string|null;contractEnd:string|null;rateBps:number|null;
 openingCapitalMicros:string;dailyYieldMicros:string;confirmedProfitMicros:string;pendingProfitMicros:string;
 projectedCapitalMicros:string;processedDays:number;pendingDays:number;accrualRemainder:number};

export function projectAccrual(row:ProjectionLease,now:Date,enabled:boolean):LiveAccrual{
 const confirmed=row.mode==='COMPOUND'?row.compoundProfitMicros:row.baseAccruedMicros;
 const result:LiveAccrual={schemaVersion:1,snapshotKey:`${row.id}:${now.getTime()}:${row.settledDays}:${confirmed}`,serverNow:now.toISOString(),
  validSnapshot:false,mode:row.mode==='BASE'||row.mode==='COMPOUND'?row.mode:null,state:'UNAVAILABLE',periodIndex:null,periodStart:null,periodEnd:null,
  contractEnd:row.epochEndsAt?.toISOString()||null,rateBps:null,openingCapitalMicros:'0',dailyYieldMicros:'0',
  confirmedProfitMicros:confirmed.toString(),pendingProfitMicros:'0',projectedCapitalMicros:(row.compoundPrincipalMicros||row.principalMicros||0n).toString(),
  processedDays:row.settledDays,pendingDays:0,accrualRemainder:row.accrualRemainder};
 const principal=row.principalMicros,days=row.contractDays,rate=row.mode==='COMPOUND'?row.compoundDailyRateBps:row.baseDailyRateBps;
 if(!row.offerVersion||!row.offerDocumentSha256||!row.termsSnapshot||!principal||principal<=0n||
   !days||!Number.isInteger(days)||days<1||days>3650||!['BASE','COMPOUND'].includes(row.mode||'')||
   !rate||!Number.isInteger(rate)||rate<1||rate>10000||!Number.isInteger(row.settledDays)||row.settledDays<0||row.settledDays>days||
   !Number.isInteger(row.accrualRemainder)||row.accrualRemainder<0||row.accrualRemainder>=10000)return result;
 result.validSnapshot=true;result.rateBps=rate;
 if(['PROVISIONING','COMPLETED','EARLY_UNBONDED','CANCELLED'].includes(row.status)){
  result.state=row.status as LiveAccrual['state'];return result;
 }
 // OVERCLOCKED is a legacy status, not an activated modern financial agreement.
 if(row.status!=='ACTIVE'||!row.activatedAt||!row.epochEndsAt||
   row.epochEndsAt.getTime()!==row.activatedAt.getTime()+days*DAY_MS||now<row.activatedAt||
   (row.mode==='COMPOUND'&&(!row.compoundPrincipalMicros||row.compoundPrincipalMicros<principal))){
  result.validSnapshot=false;return result;
 }
 if(!enabled){result.state='PAUSED';return result;}
 const fullDays=Math.min(days,Math.floor((Math.min(now.getTime(),row.epochEndsAt.getTime())-row.activatedAt.getTime())/DAY_MS));
 if(row.settledDays>fullDays){result.state='SYNCING';return result;}
 let capital=row.compoundPrincipalMicros||principal,remainder=row.accrualRemainder,pending=0n;
 for(let day=row.settledDays;day<fullDays;day++){
  const amount=accrueDay(row.mode==='BASE'?principal:capital,rate,remainder);
  remainder=amount.remainder;pending+=amount.yieldMicros;
  if(row.mode==='COMPOUND')capital+=amount.yieldMicros;
 }
 result.pendingDays=fullDays-row.settledDays;result.pendingProfitMicros=pending.toString();
 result.projectedCapitalMicros=capital.toString();result.accrualRemainder=remainder;
 if(fullDays===days){result.state='SYNCING';return result;}
 const start=row.activatedAt.getTime()+fullDays*DAY_MS;
 result.state='ACTIVE';result.periodIndex=fullDays+1;result.periodStart=new Date(start).toISOString();
 result.periodEnd=new Date(Math.min(start+DAY_MS,row.epochEndsAt.getTime())).toISOString();
 const opening=row.mode==='BASE'?principal:capital;
 result.openingCapitalMicros=opening.toString();result.dailyYieldMicros=accrueDay(opening,rate,remainder).yieldMicros.toString();
 return result;
}
