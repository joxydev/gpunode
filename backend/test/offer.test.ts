import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {journey,OFFER_DOCUMENT_SHA256,OFFER_VERSION,offerDocumentMatches,offerTariffs} from '../src/offer.js';

test('public offer constants and fixed tariff grid are immutable',()=>{
  assert.equal(OFFER_VERSION,'88-2026-AI-2026-09-30');
  assert.equal(OFFER_DOCUMENT_SHA256,'0c8e7036a52be9d1ff415a5a44f76743246e032aff0fe14300fa11f973e1a8eb');
  assert.deepEqual(offerTariffs.map(t=>[t.depositUsdt,t.days,t.dailyPercent,t.compoundPercent,t.termPercent]),[
    ['50',30,'1.50','1.80','45'],
    ['300',60,'2.50','3.00','150'],
    ['1200',90,'3.50','4.20','315'],
    ['5000',180,null,null,null]
  ]);
});

test('profile journey advances deterministically without pretending payments work',()=>{
  const fresh=journey({selected:false,funded:false,ordered:false,epochComplete:false});
  assert.deepEqual(fresh.map(s=>s.state),['DONE','CURRENT','WAITING','WAITING','LOCKED']);
  const selected=journey({selected:true,funded:false,ordered:false,epochComplete:false});
  assert.equal(selected[1].state,'DONE');assert.equal(selected[2].state,'WAITING');assert.equal(selected[2].available,false);
  const ready=journey({selected:true,funded:true,ordered:false,epochComplete:false});
  assert.equal(ready[3].state,'WAITING');assert.equal(ready[3].available,false);
  const pending=journey({selected:true,funded:true,ordered:false,pendingOrder:true,epochComplete:false});
  assert.equal(pending[3].state,'WAITING');assert.equal(pending[3].available,false);
  const expired=journey({selected:true,funded:true,ordered:true,epochComplete:true});
  assert.deepEqual(expired.map(s=>s.state),['DONE','DONE','DONE','DONE','CURRENT']);
});

test('acceptance is possible only for the PDF bytes of the new edition',()=>{
 const root=mkdtempSync(join(tmpdir(),'offer-'));
 try{
  const path=join(root,'frontend/dist/documents/public-offer-aethermind.pdf');
  mkdirSync(join(root,'frontend/dist/documents'),{recursive:true});
  copyFileSync(new URL('../../frontend/public/documents/public-offer-aethermind.pdf',import.meta.url),path);
  assert.equal(offerDocumentMatches(root),true);
  writeFileSync(path,'stale offer');
  assert.equal(offerDocumentMatches(root),false);
 }finally{rmSync(root,{recursive:true,force:true})}
});
