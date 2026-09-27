// Read-only promotion gate. Runs against the deployed release with DATABASE_URL from root-only runtime.env.
import pg from 'pg';
import {Address} from '@ton/ton';
import {TonCenter} from '../backend/dist/ton/center.js';
import {tonConfig} from '../backend/dist/ton/config.js';
import {parseNotification} from '../backend/dist/ton/notification.js';

const [mode,invoiceId,txHash]=process.argv.slice(2);
if(!['standard','gasless'].includes(mode)||!/^dep_[a-f0-9]{32}$/.test(invoiceId||'')||! /^[a-f0-9]{64}$/.test(txHash||''))throw Error('Expected mode, invoice ID and transaction hash');
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try{
 const {rows:[d]}=await db.query('SELECT d.id,d.user_id,d.status,d.invoice_id,d.tx_hash,d.trace_id,d.query_id,d.created_at,d.expires_at,d.requested_micros::text AS amount,d.received_micros::text AS received,d.sender_address,d.recipient_address,d.jetton_master,d.metadata,w.wallet_version,w.public_key,w.wallet_id FROM deposits d LEFT JOIN user_wallets w ON w.user_id=d.user_id WHERE d.invoice_id=$1',[invoiceId]);
 const canaryIds=new Set([process.env.OWNER_TELEGRAM_ID,...(process.env.TON_PAYMENT_TEST_TELEGRAM_IDS||'').split(',').filter(Boolean)]);
 if(!d||!canaryIds.has(d.user_id)||d.status!=='CREDITED'||d.tx_hash!==txHash||d.amount!==d.received||!d.trace_id)throw Error('Authorized Mainnet canary invoice/trace/amount not verified');
 if(d.metadata?.manualReconciliation)throw Error('Manually reconciled payment cannot promote the standard or gasless Mainnet canary');
 if(!Address.parse(d.recipient_address).equals(Address.parse(process.env.AETHERMIND_TREASURY_ADDRESS))||!Address.parse(d.jetton_master).equals(Address.parse(process.env.USDT_TON_MASTER)))throw Error('Unexpected treasury or Jetton master');
 if(Address.parse(d.sender_address).equals(Address.parse(d.recipient_address)))throw Error('A transfer from the treasury to itself cannot be a deposit smoke test');
 const {rows:[ledger]}=await db.query('SELECT COUNT(*)::int AS n, MIN(amount_micros)::text AS amount, MIN(balance_after-balance_before)::text AS delta FROM wallet_ledger WHERE deposit_id=$1',[d.id]);
 const {rows:[entry]}=await db.query('SELECT COUNT(*)::int AS n, MIN("amountMicros")::text AS amount FROM "LedgerEntry" WHERE "sourceId"=$1',['ton-deposit:'+d.id]);
 if(ledger.n!==1||entry.n!==1||ledger.amount!==d.amount||ledger.delta!==d.amount||entry.amount!==d.amount)throw Error('Ledger does not contain exactly one full credit');
 const config=tonConfig(),expectedForward=d.metadata?.notificationForwardNano;
 if(!/^[1-9][0-9]*$/.test(expectedForward||'')||BigInt(expectedForward)!==config.notificationForwardNano)throw Error('Canary notification funding differs from active configuration');
 if(mode==='standard'){
  if(d.metadata?.standardAttachNano!==config.attachAmount.toString()||config.ownerSmokeAttach!==null||BigInt(d.metadata.standardAttachNano)<BigInt(expectedForward)+20000000n||d.metadata?.paymentMode==='GASLESS')throw Error('Standard canary invoice differs from current public execution value');
 }else{
  const quote=d.metadata?.gasless;
  if(d.metadata?.paymentMode!=='GASLESS'||!quote?.relaySubmittedAt||!quote.fee||!['gasless','gasless-generic-transfer'].includes(quote.protocol)||! /^[a-f0-9]{64}$/.test(quote.messageDigest||'')||d.wallet_version!=='W5'||! /^\d{1,10}$/.test(d.wallet_id||'')||! /^[a-f0-9]{64}$/.test(d.public_key||''))throw Error('This is not a confirmed W5 gasless canary payment');
  if(BigInt(quote.totalMicros)!==BigInt(d.amount)+BigInt(quote.fee)||!quote.relayAddress||Address.parse(quote.relayAddress).equals(Address.parse(d.recipient_address)))throw Error('Gasless quote economics differ');
 }
 // Verify the actual chain records. A manually inserted database status, an
 // aborted owner notification or an indexed transfer alone cannot promote.
 const center=new TonCenter(config),trustedJetton=await center.jettonWallet(config.treasury);
 const from=Math.max(1,Math.floor(new Date(d.created_at).getTime()/1000)-300);
 let owner=null,transfer=null;
 for(let offset=0;offset<1000;offset+=100){
  const batch=await center.transactions(from,offset,100);
  owner=batch.map(tx=>parseNotification(tx,config,trustedJetton)).find(note=>note?.txHash===txHash)||owner;
  if(owner||batch.length<100)break;
 }
 if(!owner||owner.traceId!==d.trace_id||owner.sender!==d.sender_address||owner.invoiceId!==invoiceId||owner.queryId!==d.query_id||owner.amount.toString()!==d.amount||owner.time*1000>new Date(d.expires_at).getTime())throw Error('Successful treasury notification not verified on TON Mainnet');
 for(let offset=0;offset<1000;offset+=100){
  const batch=await center.jettonTransfers(from,offset,100);
  transfer=batch.find(tx=>tx.trace_id===d.trace_id&&String(tx.query_id)===d.query_id&&tx.decoded_forward_payload?.comment==='AETHERMIND:'+invoiceId)||transfer;
  if(transfer||batch.length<100)break;
 }
 if(!transfer||transfer.transaction_aborted!==false||transfer.forward_ton_amount!==expectedForward||String(transfer.amount)!==d.amount||!Address.parse(transfer.source).equals(Address.parse(d.sender_address))||!Address.parse(transfer.destination).equals(config.treasury)||!Address.parse(transfer.jetton_master).equals(config.master))throw Error('Indexed Jetton transfer or notification funding not verified');
 process.stdout.write(JSON.stringify({invoiceId:d.invoice_id,userId:d.user_id,amountMicros:d.amount,txHash:d.tx_hash,traceId:d.trace_id,senderWallet:d.sender_address,mode,ledgerEntries:ledger.n,legacyEntries:entry.n,network:'TON Mainnet',feeMicros:mode==='gasless'?d.metadata.gasless.fee:undefined,totalMicros:mode==='gasless'?d.metadata.gasless.totalMicros:undefined,relayAddress:mode==='gasless'?d.metadata.gasless.relayAddress:undefined,relayExternalHash:mode==='gasless'?d.metadata.gasless.relayExternalHash:undefined},null,2)+'\n');
}finally{await db.end()}
