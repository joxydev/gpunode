import {Address,Cell} from '@ton/ton';
import type {Config} from './center.js';

export type ChainTransaction={
 hash:string;account:string;now:number;trace_id?:string;emulated?:boolean;finality?:number;
 description?:{aborted?:boolean;compute_ph?:{success?:boolean};action?:{success?:boolean}};
 in_msg?:{source?:string;destination?:string;bounced?:boolean;message_content?:{body?:string}};
 out_msgs?:unknown[];
};
export type Notification={txHash:string;traceId:string|null;time:number;sender:string;amount:bigint;invoiceId:string|null;queryId:string};

export function parseNotification(tx:ChainTransaction,config:Config,treasuryJetton:Address):Notification|null{
 if(typeof tx.hash!=='string'||!(/^[0-9a-fA-F]{64}$/.test(tx.hash)||/^[A-Za-z0-9+/\-_]{43}=?$/.test(tx.hash)))return null;
 if(!Number.isSafeInteger(tx.now)||tx.now<=0||tx.emulated===true||
  tx.description?.aborted!==false||tx.description?.compute_ph?.success!==true||
  tx.description.action?.success===false||tx.in_msg?.bounced!==false||!Array.isArray(tx.out_msgs)||tx.out_msgs.length!==0)return null;
 try{
  if(!Address.parse(tx.account).equals(config.treasury)||!Address.parse(tx.in_msg!.destination!).equals(config.treasury)||
   !Address.parse(tx.in_msg!.source!).equals(treasuryJetton))return null;
  const raw=tx.in_msg?.message_content?.body;
  if(typeof raw!=='string'||raw.length>12000)return null;
  const s=Cell.fromBase64(raw).beginParse();
  if(s.loadUint(32)!==0x7362d09c)return null;
  const queryId=s.loadUintBig(64).toString();
  const amount=s.loadCoins();if(amount<=0n)return null;
  const sender=s.loadAddress();if(!sender)return null;
  const payload=s.loadBit()?s.loadRef().beginParse():s;
  if(payload.loadUint(32)!==0)return null; // standard text comment
  const text=payload.loadStringTail();
  const invoiceId=/^AETHERMIND:(dep_[a-f0-9]{32})$/.exec(text)?.[1]||null;
  const bytes=/^[0-9a-fA-F]{64}$/.test(tx.hash)?Buffer.from(tx.hash,'hex'):Buffer.from(tx.hash.replace(/-/g,'+').replace(/_/g,'/'),'base64');
  if(bytes.length!==32)return null;
  return {txHash:bytes.toString('hex'),traceId:typeof tx.trace_id==='string'?tx.trace_id:null,time:tx.now,sender:sender.toRawString(),amount,invoiceId,queryId};
 }catch{return null;}
}
