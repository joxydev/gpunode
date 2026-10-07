import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {OFFER_DOCUMENT_SHA256,OFFER_PUBLISHED_AT,OFFER_VERSION} from './offer.js';

// Financial terms are in the corrected public offer accepted by each user.
export const FINANCIAL_OFFER_DRAFT_VERSION='88-2026-AI-FINANCIAL-DRAFT-2026-09-29';
export const FINANCIAL_OFFER_DOCUMENT='/documents/public-offer-aethermind.pdf';
export type FinancialOffer={version:string;sha256:string;publishedAt:string;documentUrl:string};
export function financialOffer():FinancialOffer|null{
 const version=OFFER_VERSION,sha256=OFFER_DOCUMENT_SHA256,publishedAt=OFFER_PUBLISHED_AT;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)||!Number.isFinite(Date.parse(publishedAt))||Date.parse(publishedAt)+7*86_400_000>Date.now())return null;
 try{
  const file=join(fileURLToPath(new URL('../..',import.meta.url)),'frontend/dist',FINANCIAL_OFFER_DOCUMENT);
  if(createHash('sha256').update(readFileSync(file)).digest('hex')!==sha256)return null;
 }catch{return null;}
 return {version,sha256,publishedAt,documentUrl:FINANCIAL_OFFER_DOCUMENT};
}
export function financialFlag(name:'PURCHASES'|'EPOCH_ACTIVATION'|'ACCRUAL'|'COMPOUND'|'EARLY_UNBONDING'){
 return process.env[`ENABLE_${name}`]==='true'&&financialOffer()!==null;
}
export function financialAccess(userId:string){
 return process.env.FINANCIAL_PUBLIC_ACCESS==='true'||userId===process.env.OWNER_TELEGRAM_ID||
  (process.env.FINANCIAL_CANARY_IDS||'').split(',').map(id=>id.trim()).filter(Boolean).includes(userId);
}
