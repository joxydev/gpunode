import {Address} from '@ton/ton';

type FeeEvidence={traceId:string;sender:Address;senderJettonWallet:Address;relay:Address;master:Address;amount:bigint};

// The relayer's USDT commission must be a distinct, successful transfer in
// the same trace as the automatically credited invoice transfer.
export function matchesGaslessFee(transfer:unknown,expected:FeeEvidence):boolean{
 if(!transfer||typeof transfer!=='object'||Array.isArray(transfer))return false;
 const row=transfer as Record<string,unknown>;
 try{
  return row.transaction_aborted===false&&row.trace_id===expected.traceId&&
   row.amount===expected.amount.toString()&&
   Address.parse(String(row.source)).equals(expected.sender)&&
   Address.parse(String(row.source_wallet)).equals(expected.senderJettonWallet)&&
   Address.parse(String(row.destination)).equals(expected.relay)&&
   Address.parse(String(row.jetton_master)).equals(expected.master);
 }catch{return false;}
}
