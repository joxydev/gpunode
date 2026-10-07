// systemd ExecStartPre: inspect the same environment passed to the real service.
// No database writes, Telegram calls or TON requests are made here.
import {readFileSync} from 'node:fs';
import {financialFlag,financialOffer} from '../backend/dist/financial-offer.js';
import {OFFER_DOCUMENT_SHA256,OFFER_VERSION} from '../backend/dist/offer.js';

const expected=JSON.parse(readFileSync(new URL('./public-runtime-flags.json',import.meta.url),'utf8'));
const mismatches=Object.keys(expected).filter(key=>process.env[key]!==expected[key]);
if(mismatches.length){
 console.error('Public runtime configuration mismatch: '+mismatches.join(', '));
 process.exitCode=1;
}else if(!/^[0-9a-f]{40}$/.test(process.env.APP_COMMIT||'')){
 console.error('Public runtime configuration mismatch: APP_COMMIT');
 process.exitCode=1;
}else{
 const offer=financialOffer();
 if(offer?.version!==OFFER_VERSION||offer?.sha256!==OFFER_DOCUMENT_SHA256||
    !['PURCHASES','EPOCH_ACTIVATION','ACCRUAL'].every(name=>financialFlag(name))){
  console.error('Public runtime offer/PDF or financial flags are not ready');
  process.exitCode=1;
 }else console.log('Public runtime preflight: deposits, orders, activation and accrual enabled');
}
