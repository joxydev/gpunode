import {microsToDecimal} from './security.js';

export type AccountAction='SELECT_TARIFF'|'ADD_FUNDS'|'REQUEST_PENDING'|'PROVISIONING'|'EPOCH_ACTIVE'|'WITHDRAW_MANUAL'|'ORDER_UNAVAILABLE';

// This is derived from persisted account, ledger, request and lease state. The
// client never decides whether money is sufficient or an Epoch is active.
export function nextAccountAction(input:{
 selected:{depositUsdt:string;name:string}|null;
 balanceMicros:bigint;
 requests:{status:string}[];
 leases:{status:string;expiresAt:Date}[];
 now?:Date;
}){
 const now=input.now||new Date();
 if(input.leases.some(lease=>lease.status==='ACTIVE'&&lease.expiresAt>now))return {kind:'EPOCH_ACTIVE' as AccountAction};
 if(input.leases.some(lease=>['PROVISIONING','OVERCLOCKED'].includes(lease.status)&&lease.expiresAt>now))return {kind:'PROVISIONING' as AccountAction};
 if(input.requests.some(request=>['REQUESTED','REVIEWED'].includes(request.status)))return {kind:'REQUEST_PENDING' as AccountAction};
 if(input.leases.some(lease=>lease.status==='EXPIRED'||['ACTIVE','OVERCLOCKED'].includes(lease.status)&&lease.expiresAt<=now))return {kind:'WITHDRAW_MANUAL' as AccountAction};
 if(!input.selected)return {kind:'SELECT_TARIFF' as AccountAction};
 const required=BigInt(input.selected.depositUsdt)*1000000n;
 if(input.balanceMicros<required)return {kind:'ADD_FUNDS' as AccountAction,tariff:input.selected.name,required:microsToDecimal(required),missing:microsToDecimal(required-input.balanceMicros)};
 return {kind:'ORDER_UNAVAILABLE' as AccountAction,tariff:input.selected.name};
}
