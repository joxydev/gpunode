import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liveAmounts,microDecimal,ServerClock,workloadFrame} from '../src/live-accrual';
import type {LiveAccrual} from '../src/api';
const start=Date.parse('2026-10-24T12:34:56Z');
const snapshot={state:'ACTIVE',validSnapshot:true,periodStart:new Date(start).toISOString(),periodEnd:new Date(start+86400000).toISOString(),
 dailyYieldMicros:'750000',confirmedProfitMicros:'0',pendingProfitMicros:'0'} as LiveAccrual;
test('second/ten-second fractions telescope exactly, including non-divisible amounts and bigint extremes',()=>{
 for(const daily of [1n,750000n,900000n,916201n,50400000n,9223372036854775807n]){
  const p={...snapshot,dailyYieldMicros:daily.toString()};let sum=0n,last=0n;
  for(let k=1;k<=8640;k++){
   const value=liveAmounts(p,start+k*10000);sum+=value.delta;
   assert.equal(value.current,daily*BigInt(k)/8640n);assert.equal(value.current-last,value.delta);last=value.current;
  }
  assert.equal(sum,daily);assert.equal(liveAmounts(p,start+86400000).current,daily);
 }
 for(const s of [0,1,9,10,11,86399,86400])assert.equal(liveAmounts(snapshot,start+s*1000).current,750000n*BigInt(s)/86400n);
 assert.equal(liveAmounts(snapshot,start+86400000).boundary,true);assert.equal(microDecimal(86n),'0.000086');
});
test('clock rejects old snapshots, suspends until sync and stops stale modelling',()=>{
 let mono=100;const clock=new ServerClock(()=>mono);assert.equal(clock.sync(new Date(start).toISOString(),0,100),true);
 mono+=11000;clock.tick();assert.equal(clock.getSnapshot().now,start+11050);
 assert.equal(clock.sync(new Date(start-1000).toISOString(),0,mono),false);
 clock.setActive(false);mono+=100000;clock.tick();assert.equal(clock.getSnapshot().ready,false);
 clock.setActive(true);assert.equal(clock.getSnapshot().ready,false);
 clock.sync(new Date(start+100000).toISOString(),mono,mono);assert.equal(clock.getSnapshot().ready,true);
 clock.setActive(true);assert.equal(clock.getSnapshot().ready,true,'duplicate activation cannot invalidate a freshly synced clock');
 mono+=90001;clock.tick();assert.equal(clock.getSnapshot().ready,false);
});
test('paused/inactive do not accrue; workload is deterministic and independent of money',()=>{
 for(const state of ['PAUSED','PROVISIONING','SYNCING','COMPLETED','EARLY_UNBONDED','CANCELLED','UNAVAILABLE'] as const)
  assert.equal(liveAmounts({...snapshot,state},start+12000).current,0n);
 assert.deepEqual(workloadFrame('same','NODE_4090',start),workloadFrame('same','NODE_4090',start));
 for(let i=0;i<20;i++)assert.ok(workloadFrame('same','NODE_A100',start+i*6000).load>=50);
});
