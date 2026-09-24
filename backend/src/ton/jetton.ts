import {Address,beginCell} from '@ton/ton';
import {friendly} from './config.js';

export function buildJettonTransfer({sender,treasury,jettonWallet,usdtAmount,queryId,invoiceId,responseDestination,attachAmount,expiresAt}:{
 sender:Address;treasury:Address;jettonWallet:Address;usdtAmount:bigint;queryId:string;invoiceId:string;
 responseDestination:Address;attachAmount:bigint;expiresAt:Date;
}){
 if(attachAmount<=0n)throw Error('Jetton transfer requires an execution value');
 const comment=beginCell().storeUint(0,32).storeStringTail('AETHERMIND:'+invoiceId).endCell();
 const body=beginCell().storeUint(0x0f8a7ea5,32).storeUint(BigInt(queryId),64)
  .storeCoins(usdtAmount).storeAddress(treasury).storeAddress(responseDestination).storeBit(0)
  .storeCoins(1n).storeBit(1).storeRef(comment).endCell();
 return {network:'-239',from:friendly(sender.toRawString()),validUntil:Math.floor(expiresAt.getTime()/1000),
  messages:[{address:friendly(jettonWallet.toRawString()),amount:attachAmount.toString(),payload:body.toBoc().toString('base64')}]};
}
