import {Address,Cell} from '@ton/ton';
import type {tonConfig} from './config.js';

type Config=ReturnType<typeof tonConfig>;
export type RelayMessage={address:string;amount:string;payload?:string;stateInit?:string};
export type RelayEstimate={relayAddress:Address;commission:string;messages:RelayMessage[];from:Address;validUntil:number;protocolName:string};

// TONAPI is a relayer. It never supplies the blockchain confirmation used by the ledger.
export class TonApiGasless {
 private cached:{relay:Address;until:number}|null=null;
 constructor(private readonly config:Config,private readonly request:typeof fetch=fetch){}
 get enabled(){return this.config.gaslessEnabled&&this.config.enabled;}
 private async call(path:string,body?:unknown){
  if(!this.enabled)throw Error('Gasless is disabled');
  const response=await this.request(this.config.tonApiBase+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+this.config.tonApiKey,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('TONAPI unavailable ('+response.status+')');
  return response.json() as Promise<unknown>;
 }
 async relay():Promise<Address|null>{
  if(!this.enabled)return null;
  if(this.cached&&this.cached.until>Date.now())return this.cached.relay;
  const data=await this.call('/v2/gasless/config') as {relay_address?:unknown;gas_jettons?:{master_id?:unknown}[]};
  if(!Array.isArray(data?.gas_jettons)||!data.gas_jettons.some(j=>{try{return Address.parse(String(j.master_id)).equals(this.config.master)}catch{return false}}))return null;
  const relay=Address.parse(String(data.relay_address));
  if(relay.workChain!==0||relay.equals(this.config.treasury))throw Error('Invalid TONAPI relay');
  this.cached={relay,until:Date.now()+30000};
  return relay;
 }
 async estimate(wallet:Address,publicKey:string,message:Cell):Promise<RelayEstimate>{
  const data=await this.call('/v2/gasless/estimate/'+encodeURIComponent(this.config.master.toRawString()),{wallet_address:wallet.toRawString(),wallet_public_key:publicKey,messages:[{boc:message.toBoc().toString('hex')}],throw_error_if_not_enough_jettons:true}) as Record<string,unknown>;
  if(!Array.isArray(data?.messages)||!Number.isInteger(data.valid_until)||typeof data.commission!=='string'||typeof data.protocol_name!=='string')throw Error('Invalid TONAPI estimate');
  return {relayAddress:Address.parse(String(data.relay_address)),commission:data.commission,messages:data.messages as RelayMessage[],from:Address.parse(String(data.from)),validUntil:Number(data.valid_until),protocolName:data.protocol_name};
 }
 async send(publicKey:string,externalBocHex:string):Promise<{external:string|null}>{
  const data=await this.call('/v2/gasless/send',{wallet_public_key:publicKey,boc:externalBocHex}) as Record<string,unknown>;
  if(typeof data?.protocol_name!=='string')throw Error('Invalid TONAPI send response');
  return {external:typeof data.external==='string'?data.external:null};
 }
}
