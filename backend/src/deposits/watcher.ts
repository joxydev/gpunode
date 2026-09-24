import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {Address} from '@ton/ton';
import {config,center} from './service.js';
import {parseNotification,type Notification,type ChainTransaction} from '../ton/notification.js';
import {usdtString,friendly} from '../ton/config.js';

// A dedicated systemd service runs this worker; API processes never scan or credit.
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL!,max:3})});

async function unmatched(note:Notification,reason:string){
 await db.unmatchedTonDeposit.upsert({where:{txHash:note.txHash},create:{txHash:note.txHash,invoiceId:note.invoiceId,senderAddress:note.sender,amountMicros:note.amount,reason,traceId:note.traceId},update:{}});
}

export async function applyNotification(prisma:PrismaClient,note:Notification){
 const deposit=note.invoiceId?await prisma.tonDeposit.findUnique({where:{invoiceId:note.invoiceId}}):null;
 if(!deposit){await prisma.unmatchedTonDeposit.upsert({where:{txHash:note.txHash},create:{txHash:note.txHash,invoiceId:note.invoiceId,senderAddress:note.sender,amountMicros:note.amount,reason:'NO_MATCHING_INVOICE',traceId:note.traceId},update:{}});return 'UNMATCHED';}
 return prisma.$transaction(async tx=>{
  // User row serializes balance updates; deposit lock prevents two workers settling it twice.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${deposit.userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM deposits WHERE id=${deposit.id}::uuid FOR UPDATE`;
  const current=await tx.tonDeposit.findUniqueOrThrow({where:{id:deposit.id}});
  if(current.status==='CREDITED'&&current.txHash===note.txHash)return 'ALREADY_CREDITED';
  const addUnmatched=async(reason:string)=>tx.unmatchedTonDeposit.upsert({where:{txHash:note.txHash},create:{txHash:note.txHash,invoiceId:note.invoiceId,senderAddress:note.sender,amountMicros:note.amount,reason,traceId:note.traceId},update:{}});
  if(['MANUAL_REVIEW','REJECTED','FAILED'].includes(current.status))return current.status;
  const previouslyUsed=await tx.tonDeposit.findFirst({where:{txHash:note.txHash,id:{not:current.id}},select:{id:true}});
  if(previouslyUsed){await addUnmatched('TRANSACTION_ALREADY_USED');return 'UNMATCHED';}
  if(current.status==='CREDITED'||current.txHash&&current.txHash!==note.txHash){await addUnmatched('INVOICE_ALREADY_USED');return 'UNMATCHED';}
  if(current.senderAddress!==note.sender||current.jettonMaster!==config.master.toRawString()||current.recipientAddress!==config.treasury.toRawString()||current.queryId!==note.queryId){await addUnmatched('SENDER_OR_INVOICE_MISMATCH');return 'UNMATCHED';}
  if(note.time*1000<current.createdAt.getTime()-60000){await addUnmatched('TRANSFER_BEFORE_INVOICE');return 'UNMATCHED';}
  if(note.amount!==current.requestedMicros||note.time*1000>current.expiresAt.getTime()){
   await tx.tonDeposit.update({where:{id:current.id},data:{status:'MANUAL_REVIEW',receivedMicros:note.amount,txHash:note.txHash,traceId:note.traceId,detectedAt:new Date(),metadata:{reason:note.amount!==current.requestedMicros?'AMOUNT_MISMATCH':'LATE_TRANSFER'}}});
   return 'MANUAL_REVIEW';
  }
  const detection=new Date();
  await tx.tonDeposit.update({where:{id:current.id},data:{status:'DETECTED',receivedMicros:note.amount,txHash:note.txHash,traceId:note.traceId,detectedAt:detection}});
  await tx.tonDeposit.update({where:{id:current.id},data:{status:'CONFIRMED',confirmedAt:detection}});
  const prior=await tx.ledgerEntry.aggregate({where:{userId:current.userId},_sum:{amountMicros:true}});
  const before=prior._sum.amountMicros||0n;
  await tx.ledgerEntry.create({data:{userId:current.userId,amountMicros:note.amount,kind:'DEPOSIT_CONFIRMED',sourceId:'ton-deposit:'+current.id}});
  await tx.walletLedger.create({data:{userId:current.userId,depositId:current.id,amountMicros:note.amount,balanceBefore:before,balanceAfter:before+note.amount,type:'DEPOSIT',asset:'USDT',metadata:{network:'TON',txHash:note.txHash}}});
  await tx.tonDeposit.update({where:{id:current.id},data:{status:'CREDITED',creditedAt:detection}});
  return 'CREDITED';
 });
}

async function notifyOwner(){
 if(!process.env.BOT_TOKEN||!process.env.OWNER_TELEGRAM_ID)return;
 const rows=await db.tonDeposit.findMany({where:{status:'CREDITED',ownerNotifiedAt:null},orderBy:{creditedAt:'asc'},take:20,include:{user:{select:{name:true,id:true}}}});
 for(const row of rows){
  const message=`AetherMind · USDT TON deposit\nUser: ${row.user.id} (${row.user.name.slice(0,50)})\nAmount: ${usdtString(row.requestedMicros)} USDT\nWallet: ${friendly(row.senderAddress)}\nTransaction: ${row.txHash}`;
  try{
   const response=await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,{method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:process.env.OWNER_TELEGRAM_ID,text:message})});
   if(!response.ok)throw Error('Telegram send failed');
   await db.tonDeposit.update({where:{id:row.id},data:{ownerNotifiedAt:new Date()}});
  }catch{console.error('Owner TON deposit notification pending',row.id);break;}
 }
}

export async function scanOnce(){
 if(!config.apiKey)throw Error('TON Center API key required for deposit watcher');
 const treasuryJetton=await center.jettonWallet(config.treasury);
 const cursor=await db.tonWatcherCursor.findUnique({where:{id:'TON_USDT'}});
 const now=Math.floor(Date.now()/1000);
 // Re-scan a one-hour overlap; pending invoices keep their full history in the search window.
 const oldest=await db.tonDeposit.findFirst({where:{status:{in:['PENDING','EXPIRED','DETECTED','CONFIRMED']},createdAt:{gte:new Date(Date.now()-30*86400000)}},orderBy:{createdAt:'asc'},select:{createdAt:true}});
 const start=Math.max(1,Math.min((cursor?.lastUtime||now)-3600,oldest?Math.floor(oldest.createdAt.getTime()/1000)-300:now));
 let count=0,highest=cursor?.lastUtime||start;
 for(let offset=0;offset<10000;offset+=100){
  const batch=await center.transactions(start,offset,100) as ChainTransaction[];
  for(const tx of batch){
   const note=parseNotification(tx,config,treasuryJetton);
   if(note){const result=await applyNotification(db,note);if(result==='CREDITED'||result==='MANUAL_REVIEW')console.info('TON deposit processed',note.invoiceId,result);}
   else{
    // An incoming message from the genuine treasury Jetton wallet without a valid
    // text invoice is preserved for human investigation. Never auto-credit it.
    try{if(tx.hash&&tx.in_msg?.source&&Address.parse(tx.in_msg.source).equals(treasuryJetton)){
     const hash=/^[a-f0-9]{64}$/i.test(tx.hash)?tx.hash.toLowerCase():Buffer.from(tx.hash.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('hex');
     if(/^[a-f0-9]{64}$/.test(hash))await db.unmatchedTonDeposit.upsert({where:{txHash:hash},create:{txHash:hash,reason:'UNREADABLE_TREASURY_NOTIFICATION',traceId:tx.trace_id||null},update:{}});
    }}catch{/* unrelated or invalid transaction */}
   }
   if(Number.isInteger(tx.now))highest=Math.max(highest,tx.now);
   count++;
  }
  if(batch.length<100)break;
  if(offset>=9900)throw Error('TON Center batch cap reached; cursor not advanced');
 }
 // The index also exposes transfers sent without a forward notification. They
 // are visible to the owner for reconciliation, but never credited from an
 // index record alone: the successful treasury notification is the credit path.
 for(let offset=0;offset<10000;offset+=100){
 const batch=await center.jettonTransfers(start,offset,100) as Record<string,unknown>[];
 for(const transfer of batch){
   let sender:string,txHash:string,trace:string|null,queryId:string,amount:bigint;
   try{
    if(transfer.transaction_aborted!==false||
       !Address.parse(String(transfer.jetton_master)).equals(config.master)||
       !Address.parse(String(transfer.destination)).equals(config.treasury)||
       !/^[1-9][0-9]*$/.test(String(transfer.amount)))continue;
    sender=Address.parse(String(transfer.source)).toRawString();
    const hash=String(transfer.transaction_hash);
    const bytes=/^[a-f0-9]{64}$/i.test(hash)?Buffer.from(hash,'hex'):Buffer.from(hash.replace(/-/g,'+').replace(/_/g,'/'),'base64');
    if(bytes.length!==32)continue;
    txHash=bytes.toString('hex');
    trace=typeof transfer.trace_id==='string'?transfer.trace_id:null;
    queryId=String(transfer.query_id);
    amount=BigInt(String(transfer.amount));
   }catch{continue;}
   // A database error must stop the scan so the cursor cannot skip the row.
   const credited=await db.tonDeposit.findFirst({where:{status:'CREDITED',senderAddress:sender,queryId,receivedMicros:amount},select:{traceId:true}});
   if(credited&&(!trace||!credited.traceId||credited.traceId===trace))continue;
   await db.unmatchedTonDeposit.upsert({where:{txHash},create:{txHash,senderAddress:sender,amountMicros:amount,traceId:trace,reason:'INDEXED_TRANSFER_REQUIRES_MANUAL_VERIFICATION',metadata:{queryId}},update:{}});
  }
  if(batch.length<100)break;
  if(offset>=9900)throw Error('TON Center Jetton index batch cap reached; cursor not advanced');
 }
 // Expire only after a complete successful reconciliation pass.
 await db.tonDeposit.updateMany({where:{status:'PENDING',expiresAt:{lt:new Date()}},data:{status:'EXPIRED'}});
 const checkpoint=Math.max(start,highest,now-300);
 await db.tonWatcherCursor.upsert({where:{id:'TON_USDT'},create:{id:'TON_USDT',lastUtime:checkpoint},update:{lastUtime:checkpoint}});
 await notifyOwner();
 return count;
}

if(process.argv[1]?.endsWith('/watcher.js')){
 let stopped=false;process.on('SIGTERM',()=>{stopped=true});process.on('SIGINT',()=>{stopped=true});
 const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
 void (async()=>{let delay=5000;try{while(!stopped){try{await scanOnce();delay=15000;}catch(e){console.error('TON Center or watcher error:',(e as Error).message);delay=Math.min(delay*2,120000);}if(!stopped)await sleep(delay);}}finally{await db.$disconnect();}})();
}
