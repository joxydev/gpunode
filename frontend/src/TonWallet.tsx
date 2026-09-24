import {TonConnectUIProvider} from '@tonconnect/ui-react';
import WalletView from './WalletView';
import type {Account} from './api';
export default function TonWallet({account,onRefresh,onLogin}:{account:Account|null;onRefresh:()=>Promise<void>;onLogin:()=>void}){
 return <TonConnectUIProvider manifestUrl={location.origin+'/tonconnect-manifest.json'}><WalletView account={account} onRefresh={onRefresh} onLogin={onLogin}/></TonConnectUIProvider>;
}
