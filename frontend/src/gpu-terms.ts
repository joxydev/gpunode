import type {Account} from './api';
export function epochDays(node:Account['activeNodes'][number],now=Date.now()){
 const start=Date.parse(node.activatedAt||(node.legacyTermsReview?node.createdAt:'')),end=Date.parse(node.epochEndsAt||node.expiresAt||''),day=86400000;
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return null;
 const total=node.contractDays||Math.max(1,Math.ceil((end-start)/day));
 return {current:Math.min(total,Math.max(1,Math.floor((now-start)/day)+1)),total,remaining:Math.max(0,Math.ceil((end-now)/day))};
}

