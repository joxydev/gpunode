import test from 'node:test';
import assert from 'node:assert/strict';
import {nextAccountAction} from '../src/account-state.js';

const now=new Date('2026-09-28T12:00:00Z');
const base={selected:{name:'Node Alpha',depositUsdt:'50'},balanceMicros:20_000_000n,requests:[],leases:[],now};
test('next action uses exact ledger balance and prioritizes persisted request and Epoch state',()=>{
 assert.equal(nextAccountAction({...base,selected:null}).kind,'SELECT_TARIFF');
 assert.deepEqual(nextAccountAction(base),{kind:'ADD_FUNDS',tariff:'Node Alpha',required:'50.000000',missing:'30.000000'});
 assert.equal(nextAccountAction({...base,requests:[{status:'REQUESTED'}]}).kind,'REQUEST_PENDING');
 assert.equal(nextAccountAction({...base,leases:[{status:'ACTIVE',expiresAt:new Date('2026-12-28T12:00:00Z')}]}).kind,'EPOCH_ACTIVE');
 assert.equal(nextAccountAction({...base,leases:[{status:'PROVISIONING',expiresAt:new Date('2026-09-27T12:00:00Z')}]}).kind,'ADD_FUNDS');
 assert.equal(nextAccountAction({...base,leases:[{status:'EXPIRED',expiresAt:new Date('2026-09-27T12:00:00Z')}]}).kind,'WITHDRAW_MANUAL');
 assert.equal(nextAccountAction({...base,balanceMicros:50_000_000n}).kind,'ORDER_UNAVAILABLE');
});
