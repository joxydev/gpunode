import {Address,toNano} from '@ton/ton';

export const DEFAULT_TREASURY='UQBHmBs516S1EKkDLj9K-hwCD-WlvRn05ieMiScK-pBBO8iH';
export const DEFAULT_MASTER='EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

function attachNanograms(value:string,field:string):bigint{
 if(!/^0\.\d{1,9}$/.test(value))throw Error(field+' must be a decimal fraction of GRAM');
 const amount=toNano(value);
 if(amount<=0n||amount>toNano('0.2'))throw Error(field+' out of range');
 return amount;
}

function testerIds(value:string):string[]{
 if(!value)return [];
 const ids=value.split(',');
 if(ids.length>5||ids.some(id=>!/^[1-9]\d{0,19}$/.test(id))||new Set(ids).size!==ids.length)throw Error('Invalid TON_PAYMENT_TEST_TELEGRAM_IDS');
 return ids;
}

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
 const access=env.TON_DEPOSIT_ACCESS|| (env.ENABLE_TON_USDT_DEPOSITS==='true'?'public':'disabled');
 if(!['disabled','canary','public'].includes(access))throw Error('Invalid TON_DEPOSIT_ACCESS');
 const enabled=access!=='disabled';
 const apiKey=env.TONCENTER_API_KEY||'';
 if(enabled&&!apiKey)throw Error('TONCENTER_API_KEY is required when deposits are enabled');
 const min=usdtUnits(env.TON_DEPOSIT_MIN_USDT||'1');
 const max=usdtUnits(env.TON_DEPOSIT_MAX_USDT||'10000');
 if(min>max)throw Error('Invalid deposit limits');
 const attachAmount=attachNanograms(env.TON_JETTON_ATTACH_GRAM||'0.1','TON_JETTON_ATTACH_GRAM');
 // This amount reaches the treasury owner inside transfer_notification. A 1-nanogram
 // notification triggers the message but can abort with no_gas, even with a funded owner.
 const notificationForwardNano=attachNanograms(env.TON_NOTIFICATION_FORWARD_GRAM||'0.02','TON_NOTIFICATION_FORWARD_GRAM');
 const minTreasuryReserve=attachNanograms(env.TON_TREASURY_MIN_GRAM||'0.02','TON_TREASURY_MIN_GRAM');
 // Canary IDs are obtained from the authenticated Telegram session, never a supplied username.
 if(env.TON_JETTON_ATTACH_SMOKE_OWNER_GRAM&&!/^\d{1,20}$/.test(env.OWNER_TELEGRAM_ID||''))throw Error('OWNER_TELEGRAM_ID required for owner attach smoke');
 const ownerSmokeAttach=env.TON_JETTON_ATTACH_SMOKE_OWNER_GRAM?attachNanograms(env.TON_JETTON_ATTACH_SMOKE_OWNER_GRAM,'TON_JETTON_ATTACH_SMOKE_OWNER_GRAM'):null;
 const smokeOwnerId=ownerSmokeAttach?env.OWNER_TELEGRAM_ID:null;
 const paymentTestIds=testerIds(env.TON_PAYMENT_TEST_TELEGRAM_IDS||'');
 const tonApiBase=env.TONAPI_BASE||'https://tonapi.io';
 if(tonApiBase!=='https://tonapi.io')throw Error('Unapproved TONAPI base');
 const tonApiKey=env.TONAPI_API_KEY||'';
 const gaslessEnabled=env.ENABLE_TON_GASLESS==='true'&&Boolean(tonApiKey);
 const gaslessSmokeOwnerOnly=env.TON_GASLESS_SMOKE_OWNER_ONLY!=='false';
 if(gaslessEnabled&&gaslessSmokeOwnerOnly&&!/^\d{1,20}$/.test(env.OWNER_TELEGRAM_ID||''))throw Error('OWNER_TELEGRAM_ID required for gasless canary');
 const gaslessAttach=attachNanograms(env.TON_GASLESS_ATTACH_GRAM||'0.1','TON_GASLESS_ATTACH_GRAM');
 // The execution value must also pay for Jetton Wallet processing and forwarding.
 if([attachAmount,gaslessAttach,...(ownerSmokeAttach?[ownerSmokeAttach]:[])].some(value=>value<notificationForwardNano+toNano('0.02')))throw Error('Jetton attach must cover notification plus execution reserve');
 const gaslessMaxFee=usdtUnits(env.TON_GASLESS_MAX_FEE_USDT||'0.25');
 if(gaslessMaxFee>usdtUnits('10'))throw Error('TON_GASLESS_MAX_FEE_USDT out of range');
 return {treasury,master,apiBase,apiKey,enabled,access,publicUrl,domain:publicUrl.hostname,min,max,attachAmount,notificationForwardNano,minTreasuryReserve,ownerSmokeAttach,smokeOwnerId,paymentTestIds,tonApiBase,tonApiKey,gaslessEnabled,gaslessAttach,gaslessMaxFee,gaslessSmokeOwnerOnly,gaslessOwnerId:env.OWNER_TELEGRAM_ID||null};
}

export function depositAccessAllows(config:ReturnType<typeof tonConfig>,userId:string){
 return config.access==='public'||config.access==='canary'&&paymentCanary(config,userId);
}

export function paymentCanary(config:ReturnType<typeof tonConfig>,userId:string){
 return userId===config.gaslessOwnerId||config.paymentTestIds.includes(userId);
}
export function attachForUser(config:ReturnType<typeof tonConfig>,userId:string){
 return config.ownerSmokeAttach!==null&&paymentCanary(config,userId)?config.ownerSmokeAttach:config.attachAmount;
}
export function structuredForUser(config:ReturnType<typeof tonConfig>,userId:string){
 // Mainnet canary must use the exact, measurable backend-generated raw message.
 return config.access==='public'&&!(config.ownerSmokeAttach!==null&&paymentCanary(config,userId));
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
