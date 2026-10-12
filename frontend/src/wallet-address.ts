import {toUserFriendlyAddress} from '@tonconnect/ui-react';

// TON Connect stores a raw workchain:hex address. Show and copy the checksummed,
// URL-safe, non-bounceable address suitable for sending funds to a user wallet.
export function walletAddressForCopy(rawAddress:string,chain:string):string|null{
 if(chain!=='-239'&&chain!=='-3')return null;
 try{return toUserFriendlyAddress(rawAddress,chain==='-3')}
 catch{return null}
}
