import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {financialFlag,financialOffer,FINANCIAL_OFFER_DRAFT_VERSION} from '../src/financial-offer.js';
import {OFFER_DOCUMENT_SHA256,OFFER_VERSION} from '../src/offer.js';

test('historic signed offer stays immutable and unsigned financial draft never enables purchases',()=>{
 const historical=readFileSync(new URL('../../frontend/public/documents/public-offer-aethermind-2026-09-21.pdf',import.meta.url));
 assert.equal(createHash('sha256').update(historical).digest('hex'),'b21177972dbdeedbea731e826b070ff7fb148ec1f96e7892536e67e40732ce88');
 const current=readFileSync(new URL('../../frontend/public/documents/public-offer-aethermind.pdf',import.meta.url));
 assert.equal(createHash('sha256').update(current).digest('hex'),OFFER_DOCUMENT_SHA256);
 assert.equal(OFFER_VERSION,'88-2026-AI-2026-09-30');
 const draft=readFileSync(new URL('../../docs/OFFER_FINANCIAL_DRAFT.pdf',import.meta.url));
 assert.equal(createHash('sha256').update(draft).digest('hex'),'93e4b0c7f6f191c753e326fdb4243d818ad533d96b2938f743bd9b5b31b885aa');
 const saved={...process.env};
 try{
  process.env.FINANCIAL_OFFER_APPROVED='true';process.env.FINANCIAL_OFFER_VERSION=FINANCIAL_OFFER_DRAFT_VERSION;
  process.env.FINANCIAL_OFFER_PUBLISHED_AT='2026-09-29';process.env.FINANCIAL_OFFER_SHA256=createHash('sha256').update(draft).digest('hex');
  process.env.ENABLE_PURCHASES='true';
  assert.equal(financialOffer(),null);assert.equal(financialFlag('PURCHASES'),false);
 }finally{for(const key of ['FINANCIAL_OFFER_APPROVED','FINANCIAL_OFFER_VERSION','FINANCIAL_OFFER_PUBLISHED_AT','FINANCIAL_OFFER_SHA256','ENABLE_PURCHASES']){
  if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
 }}
});
