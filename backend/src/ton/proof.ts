import {createHash,createPublicKey,verify as edVerify} from 'node:crypto';
import {Address,Cell,contractAddress,loadStateInit,WalletContractV5R1,WalletContractV4,WalletContractV3R2} from '@ton/ton';
import type {TonCenter} from './center.js';
import type {Config} from './center.js';

export type Proof={timestamp:number;domain:{lengthBytes:number;value:string};payload:string;signature:string};
export type ProofInput={address:string;network:string;walletStateInit:string;proof:Proof;walletApp?:string};
const sha=(data:Buffer)=>createHash('sha256').update(data).digest();
const spki=Buffer.from('302a300506032b6570032100','hex');
const empty=Buffer.alloc(32);
const contracts=[
 {version:'W5',code:WalletContractV5R1.create({workchain:0,publicKey:empty}).init.code,extract:(cell:Cell)=>{const s=cell.beginParse();s.loadBit();s.loadUint(32);s.loadUint(32);return s.loadBuffer(32)}},
 {version:'V4R2',code:WalletContractV4.create({workchain:0,publicKey:empty}).init.code,extract:(cell:Cell)=>{const s=cell.beginParse();s.loadUint(32);s.loadUint(32);return s.loadBuffer(32)}},
 {version:'V3R2',code:WalletContractV3R2.create({workchain:0,publicKey:empty}).init.code,extract:(cell:Cell)=>{const s=cell.beginParse();s.loadUint(32);s.loadUint(32);return s.loadBuffer(32)}}
];
export async function verifyTonProof(input:ProofInput,expectedPayload:string,config:Config,center:Pick<TonCenter,'publicKey'>,now=Date.now()):Promise<{address:string;publicKey:string;walletVersion:string;walletId:string|null}>{
 if(!input||typeof input!=='object'||input.network!=='-239'||typeof input.address!=='string'||
  typeof input.walletStateInit!=='string'||input.walletStateInit.length>12000||
  !input.proof||typeof input.proof.payload!=='string'||input.proof.payload!==expectedPayload||
  input.proof.domain?.value!==config.domain||!Number.isInteger(input.proof.timestamp)||
  Math.abs(Math.floor(now/1000)-input.proof.timestamp)>900||
  typeof input.proof.signature!=='string'||! /^[A-Za-z0-9+/]{86}==$/.test(input.proof.signature))throw Error('Invalid TON Proof');
 const address=Address.parse(input.address);
 if(address.workChain!==0)throw Error('Unsupported workchain');
 const domain=Buffer.from(input.proof.domain.value,'utf8');
 if(input.proof.domain.lengthBytes!==domain.length||domain.length>255)throw Error('Invalid domain');
 const state=loadStateInit(Cell.fromBase64(input.walletStateInit).beginParse());
 if(!contractAddress(0,state).equals(address))throw Error('StateInit address mismatch');
 let key:Buffer|null=null,walletVersion='UNKNOWN';
 for(const known of contracts)if(state.code?.equals(known.code)&&state.data){key=known.extract(state.data);walletVersion=known.version;break;}
 if(!key)key=await center.publicKey(address);
 if(!key||key.length!==32)throw Error('Wallet public key unavailable');
 const wc=Buffer.alloc(4);wc.writeInt32BE(address.workChain);
 const domainLen=Buffer.alloc(4);domainLen.writeUInt32LE(domain.length);
 const ts=Buffer.alloc(8);ts.writeBigUInt64LE(BigInt(input.proof.timestamp));
 const msg=Buffer.concat([Buffer.from('ton-proof-item-v2/'),wc,address.hash,domainLen,domain,ts,Buffer.from(expectedPayload,'utf8')]);
 const digest=sha(Buffer.concat([Buffer.from([255,255]),Buffer.from('ton-connect'),sha(msg)]));
 const verified=edVerify(null,digest,createPublicKey({key:Buffer.concat([spki,key]),format:'der',type:'spki'}),Buffer.from(input.proof.signature,'base64'));
 if(!verified)throw Error('TON Proof signature mismatch');
 let walletId:string|null=null;
 if(walletVersion==='W5'&&state.data){const data=state.data.beginParse();data.loadBit();data.loadUint(32);walletId=data.loadUint(32).toString();}
 return {address:address.toRawString(),publicKey:key.toString('hex'),walletVersion,walletId};
}
