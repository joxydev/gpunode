import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// The signed financial edition is supplied and approved separately. The old
// accepted offer and its signed PDF must remain accessible in every release.
export const FINANCIAL_OFFER_DRAFT_VERSION='88-2026-AI-FINANCIAL-DRAFT-2026-09-29';
export const FINANCIAL_OFFER_DOCUMENT='/documents/public-offer-aethermind-financial-signed.pdf';
export type FinancialOffer={version:string;sha256:string;publishedAt:string;documentUrl:string};
export function financialOffer():FinancialOffer|null{
 const {FINANCIAL_OFFER_VERSION:version,FINANCIAL_OFFER_SHA256:sha256,FINANCIAL_OFFER_PUBLISHED_AT:publishedAt,FINANCIAL_OFFER_APPROVED:approved}=process.env;
 if(approved!=='true'||!version||version===FINANCIAL_OFFER_DRAFT_VERSION||!/^88-2026-AI-FINANCIAL-\d{4}-\d{2}-\d{2}$/.test(version)||
  !sha256||!/^([0-9a-f]{64})$/.test(sha256)||!publishedAt||!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)||
  version!==`88-2026-AI-FINANCIAL-${publishedAt}`||!Number.isFinite(Date.parse(publishedAt))||Date.parse(publishedAt)+7*86_400_000>Date.now())return null;
 try{
  // Isolated aethermind_ci uses the review draft solely as a hash fixture. It
  // never copies that file to the signed public URL or alters production gates.
  const isolated=process.env.CI_INTEGRATION==='1'&&process.env.DATABASE_URL?.endsWith('/aethermind_ci');
  const file=isolated?join(process.cwd(),'docs/OFFER_FINANCIAL_DRAFT.pdf'):join(process.cwd(),'frontend/dist',FINANCIAL_OFFER_DOCUMENT);
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
