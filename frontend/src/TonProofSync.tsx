import {useEffect,useRef} from 'react';
import {useIsConnectionRestored,useTonWallet} from '@tonconnect/ui-react';
import {api,type Account} from './api';

// A wallet can be connected from Finance or Profile. Verify its TON Proof once
// for the whole account; a wallet submission alone never credits a deposit.
export default function TonProofSync({account,onRefresh,onError}:{account:Account|null;onRefresh:()=>Promise<void>;onError:(message:string)=>void}){
 const wallet=useTonWallet(),restored=useIsConnectionRestored(),seen=useRef('');
 useEffect(()=>{
  if(!account||!restored||!wallet||wallet.account.chain!=='-239')return;
  const proof=wallet.connectItems?.tonProof;
  if(!proof||!('proof' in proof)||!proof.proof)return;
  const marker=account.user.id+':'+proof.proof.payload;
  if(seen.current===marker)return;
  seen.current=marker;
  void api('/v1/ton/proof/verify',{address:wallet.account.address,network:wallet.account.chain,walletStateInit:wallet.account.walletStateInit,proof:proof.proof,walletApp:wallet.device.appName}).then(onRefresh).catch(e=>onError((e as Error).message));
 },[account?.user.id,restored,wallet?.account.address,wallet?.connectItems,onRefresh,onError]);
 return null;
}
