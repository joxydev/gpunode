// Read-only promotion gate. Runs against the deployed release with DATABASE_URL from root-only runtime.env.
import pg from 'pg';
import {Address} from '@ton/ton';

const [mode,invoiceId,txHash]=process.argv.slice(2);
if(!['standard','gasless'].includes(mode)||!/^dep_[a-f0-9]{32}$/.test(invoiceId||'')||! /^[a-f0-9]{64}$/.test(txHash||''))throw Error('Expected mode, invoice ID and transaction hash');
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try{
 const {rows:[d]}=await db.query('SELECT d.id,d.user_id,d.status,d.invoice_id,d.tx_hash,d.trace_id,d.requested_micros::text AS amount,d.received_micros::text AS received,d.sender_address,d.recipient_address,d.jetton_master,d.metadata,w.wallet_version,w.public_key FROM deposits d LEFT JOIN user_wallets w ON w.user_id=d.user_id WHERE d.invoice_id=$1',[invoiceId]);
 if(!d||d.user_id!==process.env.OWNER_TELEGRAM_ID||d.status!=='CREDITED'||d.tx_hash!==txHash||d.amount!==d.received||!d.trace_id)throw Error('Owner Mainnet invoice/trace/amount not verified');
 if(!Address.parse(d.recipient_address).equals(Address.parse(process.env.AETHERMIND_TREASURY_ADDRESS))||!Address.parse(d.jetton_master).equals(Address.parse(process.env.USDT_TON_MASTER)))throw Error('Unexpected treasury or Jetton master');
 const {rows:[ledger]}=await db.query('SELECT COUNT(*)::int AS n, MIN(amount_micros)::text AS amount, MIN(balance_after-balance_before)::text AS delta FROM wallet_ledger WHERE deposit_id=$1',[d.id]);
 const {rows:[entry]}=await db.query('SELECT COUNT(*)::int AS n, MIN("amountMicros")::text AS amount FROM "LedgerEntry" WHERE "sourceId"=$1',['ton-deposit:'+d.id]);
 if(ledger.n!==1||entry.n!==1||ledger.amount!==d.amount||ledger.delta!==d.amount||entry.amount!==d.amount)throw Error('Ledger does not contain exactly one full credit');
 if(mode==='standard'){
  if(d.metadata?.standardAttachNano!=='50000000'||d.metadata?.paymentMode==='GASLESS')throw Error('This invoice was not created with the standard 0.05 GRAM canary');
 }else if(d.metadata?.paymentMode!=='GASLESS'||!d.metadata?.gasless?.relaySubmittedAt||!d.metadata?.gasless?.fee||d.wallet_version!=='W5'||! /^[a-f0-9]{64}$/.test(d.public_key||''))throw Error('This is not a confirmed W5 gasless owner payment');
 process.stdout.write(JSON.stringify({invoiceId:d.invoice_id,amountMicros:d.amount,txHash:d.tx_hash,traceId:d.trace_id,ownerWallet:d.sender_address,mode,ledgerEntries:ledger.n,legacyEntries:entry.n,network:'TON Mainnet',feeMicros:mode==='gasless'?d.metadata.gasless.fee:undefined},null,2)+'\n');
}finally{await db.end()}
