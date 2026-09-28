import type {Account} from './api';

export type DepositSummary={id:string;amount:string;status:string;createdAt:string};
export type ActivityRow={id:string;at:string;title:string;subtitle:string;amount:string};
export function displayBalance(value:string,locale:string){
 const [whole,fraction='']=value.split('.');
 return new Intl.NumberFormat(locale).format(BigInt(whole||'0'))+'.'+fraction.padEnd(2,'0').slice(0,2);
}
export function recentActivity(account:Account,deposits:DepositSummary[],t:(text:string)=>string):ActivityRow[]{
 return [
  ...account.entries.slice(0,5).map(row=>({id:'ledger-'+row.id,at:row.createdAt,title:['TON_DEPOSIT','DEPOSIT','DEPOSIT_CONFIRMED','CRYPTO_DEPOSIT_CONFIRMED'].includes(row.kind)?t('Пополнение'):t('Операция'),subtitle:t('Подтверждено'),amount:(row.amount.startsWith('-')?'':'+')+row.amount+' USDT'})),
  ...(account.selectedTariff?.selectedAt?[{id:'tariff',at:account.selectedTariff.selectedAt,title:account.selectedTariff.name,subtitle:t('Тариф выбран'),amount:''}]:[]),
  ...account.tickets.filter(ticket=>ticket.userUnread).slice(0,2).map(ticket=>({id:'ticket-'+ticket.id,at:ticket.lastMessageAt,title:t('Поддержка'),subtitle:t('Новый ответ'),amount:''})),
  ...deposits.filter(deposit=>deposit.status!=='CREDITED').slice(0,3).map(deposit=>({id:'deposit-'+deposit.id,at:deposit.createdAt,title:t('Пополнение'),subtitle:t(deposit.status==='PENDING'?'Ожидаем перевод':deposit.status),amount:deposit.amount+' USDT'}))
 ].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,5);
}
