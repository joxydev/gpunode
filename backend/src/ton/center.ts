import {Address,JettonMaster,TonClient} from '@ton/ton';
import type {tonConfig} from './config.js';

export type Config=ReturnType<typeof tonConfig>;
export class TonCenter {
 private client:TonClient;
 constructor(readonly config:Config){
  // Getter calls use the v2 JSON RPC; indexed transaction polling uses the v3 API.
  this.client=new TonClient({endpoint:'https://toncenter.com/api/v2/jsonRPC',apiKey:config.apiKey||undefined,timeout:10000});
 }
 async jettonWallet(owner:Address):Promise<Address>{
  const master=this.client.open(JettonMaster.create(this.config.master));
  return master.getWalletAddress(owner);
 }
 async publicKey(address:Address):Promise<Buffer|null>{
  try{
   const result=await this.client.runMethod(address,'get_public_key');
   return Buffer.from(result.stack.readBigNumber().toString(16).padStart(64,'0'),'hex');
  }catch{return null;}
 }
 async transactions(from:number,offset:number,limit=100){
  const url=new URL(this.config.apiBase+'/transactions');
  url.searchParams.set('account',this.config.treasury.toRawString());
  url.searchParams.set('start_utime',String(from));
  url.searchParams.set('sort','asc');
  url.searchParams.set('offset',String(offset));
  url.searchParams.set('limit',String(limit));
  const response=await fetch(url,{headers:this.config.apiKey?{'X-API-Key':this.config.apiKey}:{},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('TON Center unavailable ('+response.status+')');
  const data=await response.json() as {transactions?:unknown[]};
  if(!Array.isArray(data.transactions))throw Error('TON Center response invalid');
  return data.transactions;
 }
 async jettonTransfers(from:number,offset:number,limit=100){
  const url=new URL(this.config.apiBase+'/jetton/transfers');
  url.searchParams.set('owner_address',this.config.treasury.toRawString());
  url.searchParams.set('jetton_master',this.config.master.toRawString());
  url.searchParams.set('direction','in');
  url.searchParams.set('start_utime',String(from));
  url.searchParams.set('sort','asc');
  url.searchParams.set('offset',String(offset));
  url.searchParams.set('limit',String(limit));
  const response=await fetch(url,{headers:this.config.apiKey?{'X-API-Key':this.config.apiKey}:{},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('TON Center Jetton index unavailable ('+response.status+')');
  const data=await response.json() as {jetton_transfers?:unknown[]};
  if(!Array.isArray(data.jetton_transfers))throw Error('TON Center Jetton index response invalid');
  return data.jetton_transfers;
 }
}
