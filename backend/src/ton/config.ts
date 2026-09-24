import {Address} from '@ton/ton';

export const DEFAULT_TREASURY='UQBHmBs516S1EKkDLj9K-hwCD-WlvRn05ieMiScK-pBBO8iH';
export const DEFAULT_MASTER='EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

export function tonConfig(env:NodeJS.ProcessEnv=process.env){
 if((env.TON_NETWORK||'mainnet')!=='mainnet'||(env.TON_CHAIN_ID||'-239')!=='-239')throw Error('TON Mainnet is the only supported network');
 if((env.TON_WALLET_VERSION||'W5')!=='W5')throw Error('Unexpected treasury wallet version');
 const treasury=Address.parse(env.AETHERMIND_TREASURY_ADDRESS||DEFAULT_TREASURY);
 const master=Address.parse(env.USDT_TON_MASTER||DEFAULT_MASTER);
 if(!master.equals(Address.parse(DEFAULT_MASTER)))throw Error('Only official USDT TON Jetton master is supported');
 if(!treasury.equals(Address.parse(DEFAULT_TREASURY)))throw Error('Treasury address differs from approved configuration');
 const apiBase=env.TONCENTER_API_BASE||'https://toncenter.com/api/v3';
 if(apiBase!=='https://toncenter.com/api/v3')throw Error('Unapproved TON Center API base');
 const publicUrl=new URL(env.PUBLIC_URL||'https://31.77.226.26');
 if(publicUrl.protocol!=='https:'||publicUrl.pathname!=='/'||publicUrl.search||publicUrl.hash)throw Error('PUBLIC_URL must be HTTPS site origin');
 const enabled=env.ENABLE_TON_USDT_DEPOSITS==='true';
 const apiKey=env.TONCENTER_API_KEY||'';
 if(enabled&&!apiKey)throw Error('TONCENTER_API_KEY is required when public deposits are enabled');
 const min=usdtUnits(env.TON_DEPOSIT_MIN_USDT||'1');
 const max=usdtUnits(env.TON_DEPOSIT_MAX_USDT||'10000');
 if(min>max)throw Error('Invalid deposit limits');
 return {treasury,master,apiBase,apiKey,enabled,publicUrl,domain:publicUrl.hostname,min,max};
}

export function usdtUnits(value:unknown):bigint{
 if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(value))throw Error('Invalid USDT amount');
 const [whole,fraction='']=value.split('.');
 const units=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
 if(units<=0n)throw Error('USDT amount must be positive');
 return units;
}
export function usdtString(units:bigint){return `${units/1000000n}.${String(units%1000000n).padStart(6,'0')}`;}
export function canonical(address:string){return Address.parse(address).toRawString();}
export function friendly(address:string){return Address.parse(address).toString({bounceable:false,urlSafe:true});}
