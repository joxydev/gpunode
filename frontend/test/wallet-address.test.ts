import assert from 'node:assert/strict';
import test from 'node:test';
import {Address} from '@ton/ton';
import {walletAddressForCopy} from '../src/wallet-address';

const raw='0:f502768a3a3aa0c9d8f0d9e52843e078ea9ac8294f38bb367583d0dc8de0c418';

test('a verified Mainnet wallet copies its non-bounceable user-friendly address',()=>{
 const copied=walletAddressForCopy(raw,'-239');
 assert.equal(copied,'UQD1AnaKOjqgydjw2eUoQ-B46prIKU84uzZ1g9DcjeDEGANz');
 const decoded=Address.parseFriendly(copied!);
 assert.equal(decoded.address.toRawString(),raw);
 assert.equal(decoded.isBounceable,false);
 assert.equal(decoded.isTestOnly,false);
});

test('a testnet wallet retains the test-only flag',()=>{
 const copied=walletAddressForCopy(raw,'-3');
 const decoded=Address.parseFriendly(copied!);
 assert.equal(decoded.address.toRawString(),raw);
 assert.equal(decoded.isTestOnly,true);
 assert.equal(decoded.isBounceable,false);
});

test('an invalid TON Connect address cannot be copied as a misleading value',()=>{
 assert.equal(walletAddressForCopy('0:invalid','-239'),null);
 assert.equal(walletAddressForCopy(raw,'unknown-network'),null);
});
