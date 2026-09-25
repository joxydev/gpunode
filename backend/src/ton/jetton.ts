import {Address,beginCell} from '@ton/ton';
import {friendly} from './config.js';

const invoiceComment=(invoiceId:string)=>beginCell().storeUint(0,32).storeStringTail('AETHERMIND:'+invoiceId).endCell();

export function buildJettonTransfer({sender,treasury,jettonWallet,usdtAmount,queryId,invoiceId,responseDestination,attachAmount,expiresAt}:{
 sender:Address;treasury:Address;jettonWallet:Address;usdtAmount:bigint;queryId:string;invoiceId:string;
 responseDestination:Address;attachAmount:bigint;expiresAt:Date;
}){
 if(attachAmount<=0n)throw Error('Jetton transfer requires an execution value');
 const comment=invoiceComment(invoiceId);
 const body=beginCell().storeUint(0x0f8a7ea5,32).storeUint(BigInt(queryId),64)
  .storeCoins(usdtAmount).storeAddress(treasury).storeAddress(responseDestination).storeBit(0)
  .storeCoins(1n).storeBit(1).storeRef(comment).endCell();
 return {network:'-239',from:friendly(sender.toRawString()),validUntil:Math.floor(expiresAt.getTime()/1000),
  messages:[{address:friendly(jettonWallet.toRawString()),amount:attachAmount.toString(),payload:body.toBoc().toString('base64')}]};
}

// Only use this when TON Connect explicitly advertises structured Jetton items.
// The wallet then estimates its own execution value; every economic field still comes from the backend.
export function buildStructuredJettonTransfer({sender,treasury,master,usdtAmount,queryId,invoiceId,expiresAt}:{
 sender:Address;treasury:Address;master:Address;usdtAmount:bigint;queryId:string;invoiceId:string;expiresAt:Date;
}){
 const comment=invoiceComment(invoiceId);
 return {network:'-239' as const,from:friendly(sender.toRawString()),validUntil:Math.floor(expiresAt.getTime()/1000),items:[{type:'jetton' as const,master:friendly(master.toRawString()),destination:friendly(treasury.toRawString()),amount:usdtAmount.toString(),responseDestination:friendly(sender.toRawString()),forwardAmount:'1',forwardPayload:comment.toBoc().toString('base64'),queryId}]};
}
