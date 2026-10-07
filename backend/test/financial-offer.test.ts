import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {financialFlag,financialOffer,FINANCIAL_OFFER_DRAFT_VERSION} from '../src/financial-offer.js';
import {OFFER_DOCUMENT_SHA256,OFFER_VERSION,offerDocumentMatches} from '../src/offer.js';

test('corrected TON edition has a fresh acceptance identity and the old editions remain archived',()=>{
 const old=readFileSync(new URL('../../frontend/public/documents/public-offer-aethermind-2026-09-21.pdf',import.meta.url));
 assert.equal(createHash('sha256').update(old).digest('hex'),'b21177972dbdeedbea731e826b070ff7fb148ec1f96e7892536e67e40732ce88');
 const previous=readFileSync(new URL('../../frontend/public/documents/public-offer-aethermind-2026-09-30-trc-bep.pdf',import.meta.url));
 assert.equal(createHash('sha256').update(previous).digest('hex'),'0c8e7036a52be9d1ff415a5a44f76743246e032aff0fe14300fa11f973e1a8eb');
 const current=readFileSync(new URL('../../frontend/public/documents/public-offer-aethermind.pdf',import.meta.url));
 assert.equal(createHash('sha256').update(current).digest('hex'),OFFER_DOCUMENT_SHA256);
 assert.equal(OFFER_VERSION,'88-2026-AI-2026-09-30-TON-2026-10-07');
 const draft=readFileSync(new URL('../../docs/OFFER_FINANCIAL_DRAFT.pdf',import.meta.url));
 assert.equal(createHash('sha256').update(draft).digest('hex'),'93e4b0c7f6f191c753e326fdb4243d818ad533d96b2938f743bd9b5b31b885aa');
 const saved={...process.env};
 try{
  process.env.FINANCIAL_OFFER_APPROVED='true';process.env.FINANCIAL_OFFER_VERSION=FINANCIAL_OFFER_DRAFT_VERSION;
  process.env.FINANCIAL_OFFER_PUBLISHED_AT='2026-09-29';process.env.FINANCIAL_OFFER_SHA256=createHash('sha256').update(draft).digest('hex');
  process.env.ENABLE_PURCHASES='true';
  const active=financialOffer();
  assert.equal(Boolean(active),offerDocumentMatches());
  if(active){assert.equal(active.version,OFFER_VERSION);assert.equal(active.sha256,OFFER_DOCUMENT_SHA256)}
  assert.equal(financialFlag('PURCHASES'),Boolean(active));
 }finally{for(const key of ['FINANCIAL_OFFER_APPROVED','FINANCIAL_OFFER_VERSION','FINANCIAL_OFFER_PUBLISHED_AT','FINANCIAL_OFFER_SHA256','ENABLE_PURCHASES']){
  if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
 }}
});
