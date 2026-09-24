import {Address,beginCell,toNano} from '@ton/ton';
import {friendly} from './config.js';

export function jettonPayment(sender:Address,treasury:Address,jettonWallet:Address,amount:bigint,queryId:string,invoiceId:string,expiresAt:Date){
 const comment=beginCell().storeUint(0,32).storeStringTail('AETHERMIND:'+invoiceId).endCell();
 const body=beginCell().storeUint(0x0f8a7ea5,32).storeUint(BigInt(queryId),64)
  .storeCoins(amount).storeAddress(treasury).storeAddress(sender).storeBit(0)
  .storeCoins(1n).storeBit(1).storeRef(comment).endCell();
 return {network:'-239',from:friendly(sender.toRawString()),validUntil:Math.floor(expiresAt.getTime()/1000),
  messages:[{address:friendly(jettonWallet.toRawString()),amount:toNano('0.1').toString(),payload:body.toBoc().toString('base64')}]};
}
