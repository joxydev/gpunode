import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Address} from '@ton/ton';
import {matchesGaslessFee} from '../src/ton/gasless-fee.js';

test('public gasless gate requires a distinct successful official USDT fee in the invoice trace',()=>{
 const sender=Address.parse('0:'+ '1'.repeat(64)),senderJettonWallet=Address.parse('0:'+ '2'.repeat(64));
 const relay=Address.parse('0:'+ '3'.repeat(64)),master=Address.parse('0:'+ '4'.repeat(64));
 const expected={traceId:'trace-1',sender,senderJettonWallet,relay,master,amount:120000n};
 const fee={trace_id:'trace-1',transaction_aborted:false,amount:'120000',source:sender.toRawString(),source_wallet:senderJettonWallet.toRawString(),destination:relay.toRawString(),jetton_master:master.toRawString()};
 assert.equal(matchesGaslessFee(fee,expected),true);
 for(const altered of [
  {trace_id:'trace-2'},{transaction_aborted:true},{amount:'120001'},
  {source:relay.toRawString()},{source_wallet:relay.toRawString()},
  {destination:sender.toRawString()},{jetton_master:relay.toRawString()},
 ])assert.equal(matchesGaslessFee({...fee,...altered},expected),false);
 assert.equal(matchesGaslessFee(null,expected),false);
});
