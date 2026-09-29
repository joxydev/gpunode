import test from 'node:test';
import assert from 'node:assert/strict';
import type {Account} from '../src/api';
import {displayBalance,recentActivity} from '../src/dashboard-model';
import {epochDays} from '../src/Assets';

test('dashboard balance remains exact and activity uses persisted events without double-counting credited invoices',()=>{
 assert.equal(displayBalance('123456789012345678.500000','en-US'),'123,456,789,012,345,678.50');
 const account={entries:[{id:'ledger-1',kind:'DEPOSIT_CONFIRMED',amount:'10.000000',createdAt:'2026-09-28T12:00:00Z'}],selectedTariff:{name:'Node Alpha',selectedAt:'2026-09-28T10:00:00Z'},tickets:[{id:'ticket-1',lastMessageAt:'2026-09-28T11:00:00Z',userUnread:true}]} as Account;
 const rows=recentActivity(account,[{id:'credited',amount:'10',status:'CREDITED',createdAt:'2026-09-28T12:00:00Z'},{id:'pending',amount:'20',status:'PENDING',createdAt:'2026-09-28T13:00:00Z'}],text=>text);
 assert.deepEqual(rows.map(row=>row.id),['deposit-pending','ledger-ledger-1','ticket-ticket-1','tariff']);
 assert.equal(rows.find(row=>row.id==='ledger-ledger-1')?.amount,'+10.000000 USDT');
 assert.equal(rows.find(row=>row.id==='ledger-ledger-1')?.title,'Пополнение');
});

test('Epoch progress uses real lease timestamps and never exceeds the term',()=>{
 const node={createdAt:'2026-08-31T00:00:00Z',activatedAt:'2026-09-01T00:00:00Z',epochEndsAt:'2026-09-30T00:00:00Z',expiresAt:'2026-09-30T00:00:00Z',contractDays:29} as Account['activeNodes'][number];
 assert.deepEqual(epochDays(node,Date.parse('2026-09-21T00:00:00Z')),{current:21,total:29,remaining:9});
 assert.equal(epochDays({...node,epochEndsAt:node.activatedAt}),null);
 assert.equal(epochDays({...node,activatedAt:null,epochEndsAt:null,expiresAt:null,legacyTermsReview:false}),null,'provisioning has no Epoch clock');
});
