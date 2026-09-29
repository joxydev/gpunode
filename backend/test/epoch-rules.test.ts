import test from 'node:test';
import assert from 'node:assert/strict';
import {accrueDay,calculateEarlyUnbondingFee,completedIntervals,DAY_MS} from '../src/epoch-rules.js';

const start=new Date('2026-10-01T12:00:00.000Z');
function quote(days:number,at:number,compoundEnabled=false){
 return calculateEarlyUnbondingFee({activatedAt:start,epochEndsAt:new Date(start.getTime()+days*DAY_MS),
  contractDays:days,principalMicros:BigInt(days===30?50:days===60?300:1200)*1000000n,
  compoundEnabled,now:new Date(start.getTime()+at)});
}
test('early fee boundaries use completed 24-hour periods and actual epoch end',()=>{
 for(const [days,steps] of [
  [30,[[0,1500],[13*DAY_MS,1500],[14*DAY_MS-1,1500],[14*DAY_MS,700],[28*DAY_MS,700],[29*DAY_MS-1,700]]],
  [60,[[0,1500],[13*DAY_MS,1500],[14*DAY_MS,700],[28*DAY_MS,700],[29*DAY_MS-1,700],[29*DAY_MS,300],[44*DAY_MS,300],[58*DAY_MS,300]]],
  [90,[[0,1500],[13*DAY_MS,1500],[14*DAY_MS,700],[28*DAY_MS,700],[29*DAY_MS,300],[58*DAY_MS,300],[59*DAY_MS-1,300],[59*DAY_MS,150],[74*DAY_MS,150],[88*DAY_MS,150]]]
 ] as const)for(const [at,bps] of steps)assert.equal(quote(days,at).feeBps,bps,`${days} days at ${at}`);
 for(const days of [30,60,90]){
  assert.equal(quote(days,days*DAY_MS-1).allowed,true);
  const end=quote(days,days*DAY_MS);assert.equal(end.allowed,false);assert.equal(end.feeBps,0);assert.equal(end.reason,'EPOCH_COMPLETED');
  assert.equal(quote(days,days*DAY_MS+1).feeMicros,0n);
 }
 assert.equal(quote(30,7*DAY_MS).feeMicros,7500000n);
 assert.equal(quote(60,44*DAY_MS).netPrincipalMicros,291000000n);
 assert.equal(quote(90,74*DAY_MS).netPrincipalMicros,1182000000n);
});
test('compound blocks stay locked throughout the complete tariff epoch',()=>{
 for(const days of [30,60,90])for(const at of [0,14*DAY_MS,29*DAY_MS,30*DAY_MS,59*DAY_MS,days*DAY_MS-1].filter(v=>v<days*DAY_MS)){
  assert.equal(quote(days,at,true).reason,'COMPOUND_LOCKED');
 }
 for(const days of [30,60,90])assert.equal(quote(days,days*DAY_MS,true).reason,'EPOCH_COMPLETED');
});
test('daily settlement is timestamp based and integer remainder survives a restart',()=>{
 const end=new Date(start.getTime()+60*DAY_MS);
 assert.equal(completedIntervals(start,end,new Date(start.getTime()+DAY_MS-1)),0);
 assert.equal(completedIntervals(start,end,new Date(start.getTime()+DAY_MS)),1);
 assert.equal(completedIntervals(start,end,new Date(start.getTime()+90*DAY_MS)),60);
 assert.equal(accrueDay(50000000n,150,0).yieldMicros,750000n);
 assert.equal(accrueDay(300000000n,250,0).yieldMicros,7500000n);
 assert.equal(accrueDay(1200000000n,350,0).yieldMicros,42000000n);
 let capital=300000000n,remainder=0;
 for(let day=1;day<=60;day++){const result=accrueDay(capital,300,remainder);capital+=result.yieldMicros;remainder=result.remainder;
  if(day===30)assert.ok(capital>300000000n);
 }
 assert.ok(capital>300000000n);assert.ok(remainder>=0&&remainder<10000);
});
