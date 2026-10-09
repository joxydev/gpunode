import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectAccrual,type ProjectionLease} from '../src/live-accrual.js';
import {accrueDay,DAY_MS} from '../src/epoch-rules.js';
const start=new Date('2026-10-24T12:34:56Z');
function lease(mode:'BASE'|'COMPOUND'='BASE',principal=50000000n,days=30,rate=mode==='BASE'?150:180):ProjectionLease{
 return {id:'fixture',status:'ACTIVE',mode,offerVersion:'offer',offerDocumentSha256:'hash',termsSnapshot:{mode},principalMicros:principal,
  baseDailyRateBps:mode==='BASE'?rate:150,compoundDailyRateBps:mode==='COMPOUND'?rate:180,contractDays:days,activatedAt:start,
  epochEndsAt:new Date(+start+days*DAY_MS),settledDays:0,accrualRemainder:0,baseAccruedMicros:0n,compoundPrincipalMicros:principal,compoundProfitMicros:0n};
}
test('BASE follows UTC activation for 30/60/90 days and carries fractional micro-USDT',()=>{
 for(const [principal,days,rate] of [[50000000n,30,150],[300000000n,60,250],[1200000000n,90,350],[50000001n,30,150]] as const){
  const row=lease('BASE',principal,days,rate),original=structuredClone(row);let sum=0n,remainder=0;
  for(let d=0;d<days;d++){
   const p=projectAccrual(row,new Date(+start+d*DAY_MS+1000),true),a=accrueDay(principal,rate,remainder);
   assert.equal(p.periodIndex,d+1);assert.equal(p.periodStart,new Date(+start+d*DAY_MS).toISOString());
   assert.equal(p.dailyYieldMicros,a.yieldMicros.toString());assert.equal(p.pendingProfitMicros,sum.toString());
   sum+=a.yieldMicros;remainder=a.remainder;
  }
  const end=projectAccrual(row,row.epochEndsAt!,true);assert.equal(end.state,'SYNCING');assert.equal(end.periodIndex,null);
  assert.equal(end.pendingProfitMicros,sum.toString());assert.deepEqual(row,original,'GET projection never mutates input');
 }
});
test('Compound first/second days, block boundaries, catch-up and settlement transfer without double counting',()=>{
 const alpha=lease('COMPOUND');assert.equal(projectAccrual(alpha,start,true).dailyYieldMicros,'900000');
 const second=projectAccrual(alpha,new Date(+start+DAY_MS+10000),true);
 assert.equal(second.openingCapitalMicros,'50900000');assert.equal(second.dailyYieldMicros,'916200');
 for(const [principal,days,rate] of [[50000000n,30,180],[300000000n,60,300],[1200000000n,90,420]] as const){
  const row=lease('COMPOUND',principal,days,rate),lagging=lease('COMPOUND',principal,days,rate);let capital=principal,profit=0n,remainder=0;
  for(let d=0;d<days;d++){
   const p=projectAccrual(row,new Date(+start+d*DAY_MS+11000),true),a=accrueDay(capital,rate,remainder);
   assert.equal(p.openingCapitalMicros,capital.toString());assert.equal(p.dailyYieldMicros,a.yieldMicros.toString());
   assert.equal(BigInt(p.confirmedProfitMicros)+BigInt(p.pendingProfitMicros),profit);
   const delayed=projectAccrual(lagging,new Date(+start+d*DAY_MS+11000),true);
   assert.equal(delayed.pendingProfitMicros,profit.toString());assert.equal(delayed.dailyYieldMicros,p.dailyYieldMicros);
   capital+=a.yieldMicros;profit+=a.yieldMicros;remainder=a.remainder;
   row.settledDays=d+1;row.compoundPrincipalMicros=capital;row.compoundProfitMicros=profit;row.accrualRemainder=remainder;
   const fresh=projectAccrual(row,new Date(+start+(d+1)*DAY_MS),true);
   assert.equal(BigInt(fresh.confirmedProfitMicros)+BigInt(fresh.pendingProfitMicros),profit);
  }
  const end=projectAccrual(row,row.epochEndsAt!,true);assert.equal(end.dailyYieldMicros,'0');assert.equal(end.periodIndex,null);
 }
});
test('no active growth for paused, future activation, non-active and invalid/legacy leases',()=>{
 assert.equal(projectAccrual(lease(),new Date(+start+DAY_MS),false).state,'PAUSED');
 for(const status of ['PROVISIONING','COMPLETED','EARLY_UNBONDED','CANCELLED','OVERCLOCKED','EXPIRED']){
  const p=projectAccrual({...lease(),status},new Date(+start+10000),true);assert.equal(p.dailyYieldMicros,'0');assert.equal(p.periodStart,null);
 }
 for(const override of [{offerVersion:null},{termsSnapshot:null},{principalMicros:null},{activatedAt:null},{accrualRemainder:10000},{settledDays:31},{baseDailyRateBps:-150},{baseDailyRateBps:10001},{contractDays:3651}]){
  assert.equal(projectAccrual({...lease(),...override},start,true).state,'UNAVAILABLE');
 }
 assert.equal(projectAccrual(lease(),new Date(+start-1),true).state,'UNAVAILABLE');
});
