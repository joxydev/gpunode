export const DAY_MS=86_400_000;
export const COMPOUND_CYCLE_DAYS=30;
export type Mode='BASE'|'COMPOUND';
export type FeeQuote={allowed:boolean;feeBps:number;feeMicros:bigint;netPrincipalMicros:bigint;cycleDay:number;reason:string|null;clause:string};

export function calculateEarlyUnbondingFee(input:{activatedAt:Date;epochEndsAt:Date;contractDays:number;principalMicros:bigint;compoundEnabled:boolean;now:Date}):FeeQuote{
 const {activatedAt,epochEndsAt,contractDays,principalMicros,compoundEnabled,now}=input;
 if(![30,60,90].includes(contractDays)||principalMicros<=0n||!Number.isFinite(activatedAt.getTime())||
  epochEndsAt.getTime()!==activatedAt.getTime()+contractDays*DAY_MS)throw Error('INVALID_LEASE_TERMS');
 const elapsed=now.getTime()-activatedAt.getTime();
 const cycleDay=Math.min(contractDays,Math.max(1,Math.floor(elapsed/DAY_MS)+1));
 if(now>=epochEndsAt)return {allowed:false,feeBps:0,feeMicros:0n,netPrincipalMicros:principalMicros,cycleDay:contractDays,reason:'EPOCH_COMPLETED',clause:'5.5'};
 if(elapsed<0)return {allowed:false,feeBps:0,feeMicros:0n,netPrincipalMicros:0n,cycleDay:0,reason:'LEASE_NOT_ACTIVE',clause:'5.5'};
 if(compoundEnabled)return {allowed:false,feeBps:0,feeMicros:0n,netPrincipalMicros:0n,cycleDay,reason:'COMPOUND_LOCKED',clause:'5.4'};
 const completedDays=Math.floor(elapsed/DAY_MS);
 const applicable=completedDays<14?1500:completedDays<29||contractDays===30?700:completedDays<59||contractDays===60?300:150;
 // Bps apply solely to the original principal; truncate below one micro-USDT.
 const feeMicros=principalMicros*BigInt(applicable)/10000n;
 return {allowed:true,feeBps:applicable,feeMicros,netPrincipalMicros:principalMicros-feeMicros,cycleDay,reason:null,clause:'5.5'};
}

export function completedIntervals(activatedAt:Date,epochEndsAt:Date,now:Date){
 return Math.max(0,Math.floor((Math.min(now.getTime(),epochEndsAt.getTime())-activatedAt.getTime())/DAY_MS));
}

export function accrueDay(principalMicros:bigint,rateBps:number,remainder:number){
 if(principalMicros<=0n||!Number.isInteger(rateBps)||rateBps<=0||rateBps>10000||!Number.isInteger(remainder)||remainder<0||remainder>=10000)throw Error('INVALID_ACCRUAL_TERMS');
 const numerator=principalMicros*BigInt(rateBps)+BigInt(remainder);
 return {yieldMicros:numerator/10000n,remainder:Number(numerator%10000n)};
}
