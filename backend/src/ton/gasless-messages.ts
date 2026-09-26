import {Address,beginCell,Cell,internal,loadMessageRelaxed,loadOutList,storeMessageRelaxed,external,storeMessage,domainSignVerify} from '@ton/ton';
import type {RelayEstimate,RelayMessage} from './gasless.js';

export type SignRequest={network:'-239';from:string;validUntil:number;messages:{address:string;amount:string;payload:string}[]};
const cellHex=(value:string)=>{
 if(!/^(?:[0-9a-f]{2}){1,8192}$/i.test(value))throw Error('Invalid provider cell');
 const cells=Cell.fromBoc(Buffer.from(value,'hex'));
 if(cells.length!==1)throw Error('Invalid provider cell count');
 return cells[0];
};
export function estimateMessage(to:Address,amount:bigint,payload:Cell){
 return beginCell().store(storeMessageRelaxed(internal({to,bounce:true,value:amount,body:payload}))).endCell();
}
function jettonTransfer(body:Cell){
 const s=body.beginParse();
 if(s.loadUint(32)!==0x0f8a7ea5)throw Error('Unexpected Jetton operation');
 const queryId=s.loadUintBig(64).toString(),amount=s.loadCoins(),destination=s.loadAddress(),response=s.loadAddress();
 if(!destination||!response||s.loadBoolean())throw Error('Unexpected Jetton payload');
 const forward=s.loadCoins();
 const comment=s.loadBoolean()?s.loadRef():beginCell().storeSlice(s).endCell();
 if(s.remainingBits||s.remainingRefs)throw Error('Unexpected Jetton suffix');
 return {queryId,amount,destination,response,forward,comment};
}
export function validateEstimate(estimate:RelayEstimate,expected:{wallet:Address;jetton:Address;treasury:Address;invoiceId:string;queryId:string;requested:bigint;relay:Address;expiresAt:Date;expectedBody:Cell;economicAttach:bigint;maxFee:bigint}):{fee:bigint;signRequest:SignRequest}{
 // Invoice comments can select TONAPI's generic-transfer protocol.
 if(!['gasless','gasless-generic-transfer'].includes(estimate.protocolName))throw Error('Unknown relayer protocol');
 if(!estimate.relayAddress.equals(expected.relay)||!estimate.from.equals(expected.wallet))throw Error('Provider changed wallet or relay');
 if(!Number.isSafeInteger(estimate.validUntil)||estimate.validUntil<=Math.floor(Date.now()/1000)+20||estimate.validUntil>Math.floor(expected.expiresAt.getTime()/1000)||estimate.messages.length!==2)throw Error('Invalid provider estimate expiry/messages');
 if(!/^[1-9][0-9]{0,18}$/.test(estimate.commission))throw Error('Invalid provider commission');
 const fee=BigInt(estimate.commission);
 const signMessages=estimate.messages.map((msg:RelayMessage)=>{
  if(typeof msg.address!=='string'||!Address.parse(msg.address).equals(expected.jetton)||! /^[1-9][0-9]{0,17}$/.test(msg.amount)||BigInt(msg.amount)>200000000n||typeof msg.payload!=='string'||msg.stateInit||Object.keys(msg).some(k=>!['address','amount','payload','stateInit'].includes(k)))throw Error('Unexpected provider message');
  const parsed=jettonTransfer(cellHex(msg.payload));
  if(!parsed.response.equals(expected.relay))throw Error('Invalid Jetton response address');
  return {raw:msg,body:cellHex(msg.payload),parsed};
 });
 const economic=signMessages.filter(x=>x.body.equals(expected.expectedBody));
 if(economic.length!==1)throw Error('Provider changed the invoice transfer');
 const feeMessage=signMessages.find(x=>x!==economic[0])!;
 if(fee>expected.maxFee||feeMessage.parsed.amount!==fee||!feeMessage.parsed.destination.equals(expected.relay)||![0n,1n].includes(feeMessage.parsed.forward)||BigInt(economic[0].raw.amount)!==expected.economicAttach)throw Error('Provider fee or execution value differs from estimate');
 // The current TONAPI cookbook sends an empty fee forward payload. An optional
 // 32-bit relayer marker is accepted; any other fee payload needs a protocol audit.
 const feePayload=feeMessage.parsed.comment.beginParse();
 if(feePayload.remainingRefs||!(feePayload.remainingBits===0||feePayload.remainingBits===32&&feePayload.loadUint(32)===0x878da6e3))throw Error('Unknown relayer fee payload');
 // Fee is a separate official USDT transfer. The treasury transfer has the exact invoice amount.
 if(economic[0].parsed.forward!==1n||economic[0].parsed.amount!==expected.requested||economic[0].parsed.queryId!==expected.queryId||!economic[0].parsed.destination.equals(expected.treasury))throw Error('Changed economic transfer');
 return {fee,signRequest:{network:'-239',from:expected.wallet.toString({bounceable:false}),validUntil:estimate.validUntil,messages:signMessages.map(({raw,body})=>({address:expected.jetton.toString({bounceable:false}),amount:raw.amount,payload:body.toBoc().toString('base64')}))}};
}

export function verifiedExternal(internalBoc:string,verified:{wallet:Address;publicKey:string;walletId:string;signRequest:SignRequest}):string{
 if(!/^[A-Za-z0-9+/]{1,60000}={0,2}$/.test(internalBoc))throw Error('Invalid signed BOC');
 const roots=Cell.fromBoc(Buffer.from(internalBoc,'base64'));
 if(roots.length!==1)throw Error('Invalid signed BOC count');
 const signed=loadMessageRelaxed(roots[0].beginParse());
 if(signed.info.type!=='internal'||!signed.info.dest.equals(verified.wallet)||signed.init)throw Error('Signed message targets another wallet');
 const slice=signed.body.beginParse();
 if(slice.loadUint(32)!==0x73696e74)throw Error('Only W5 signed internal is accepted');
 const walletId=slice.loadUint(32),timeout=slice.loadUint(32),seqno=slice.loadUint(32);
 if(walletId.toString()!==verified.walletId)throw Error('Signed W5 wallet ID differs from TON Proof');
 if(timeout!==verified.signRequest.validUntil||timeout<=Math.floor(Date.now()/1000))throw Error('Signed estimate expired');
 const actionsCell=slice.loadMaybeRef();
 if(!actionsCell||slice.loadBoolean()||slice.remainingRefs||slice.remainingBits!==512)throw Error('Invalid W5 action list');
 const signature=slice.loadBuffer(64);
 const preimage=beginCell().storeUint(0x73696e74,32).storeUint(walletId,32).storeUint(timeout,32).storeUint(seqno,32).storeMaybeRef(actionsCell).storeBit(false).endCell();
 if(!/^[a-f0-9]{64}$/.test(verified.publicKey)||!domainSignVerify({data:preimage.hash(),signature,publicKey:Buffer.from(verified.publicKey,'hex')}))throw Error('Invalid W5 signature');
 const actions=loadOutList(actionsCell.beginParse());
 if(actions.length!==verified.signRequest.messages.length)throw Error('Signed message count differs');
 for(let i=0;i<actions.length;i++){
  const action=actions[i],expected=verified.signRequest.messages[i];
  if(action.type!=='sendMsg'||![1,3].includes(action.mode)||action.outMsg.info.type!=='internal'||(!action.outMsg.info.ihrDisabled||!action.outMsg.info.bounce||action.outMsg.info.bounced||action.outMsg.info.src||action.outMsg.info.ihrFee!==0n||action.outMsg.info.forwardFee!==0n||action.outMsg.info.createdAt!==0||action.outMsg.info.createdLt!==0n)||!action.outMsg.info.dest.equals(Address.parse(expected.address))||action.outMsg.info.value.coins!==BigInt(expected.amount)||!action.outMsg.body.equals(Cell.fromBase64(expected.payload))||action.outMsg.init||Boolean(action.outMsg.info.value.other?.size))throw Error('Signed economic action differs');
 }
 return beginCell().store(storeMessage(external({to:verified.wallet,body:signed.body}))).endCell().toBoc().toString('hex');
}
