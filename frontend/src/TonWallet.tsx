import WalletView from './WalletView';
import type {Account} from './api';
export default function TonWallet({account,onRefresh,onLogin,onSupport,onWithdraw,initialView,viewRequest}:{account:Account|null;onRefresh:()=>Promise<void>;onLogin:()=>void;onSupport:(reference?:{referenceType:'DEPOSIT'|'WITHDRAWAL';referenceId:string;invoiceId?:string})=>void;onWithdraw:()=>void;initialView:'deposit'|null;viewRequest:number}){
 return <WalletView account={account} onRefresh={onRefresh} onLogin={onLogin} onSupport={onSupport} onWithdraw={onWithdraw} initialView={initialView} viewRequest={viewRequest}/>;
}
