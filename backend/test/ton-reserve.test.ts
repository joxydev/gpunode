import test from 'node:test';
import assert from 'node:assert/strict';
import {toNano} from '@ton/ton';
import {center,treasuryReady} from '../src/deposits/service.js';

test('treasury owner reserve gates invoice creation and fails closed on RPC errors',async()=>{
 const original=center.treasuryBalance;
 try{
  center.treasuryBalance=async()=>toNano('0.000196492');
  assert.equal(await treasuryReady(true),false,'owner reserve is an operational gate, independent of notification funding');
  center.treasuryBalance=async()=>toNano('0.03');
  assert.equal(await treasuryReady(true),true);
  center.treasuryBalance=async()=>{throw Error('indexer timeout')};
  assert.equal(await treasuryReady(true),false);
 }finally{center.treasuryBalance=original;}
});
