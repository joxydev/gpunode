import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const OFFER_NUMBER='88/2026-AI';
// The version identifies the edition printed on the PDF. The actual publication
// date is recorded at deployment; it must not be backdated to the PDF's date.
export const OFFER_VERSION='88-2026-AI-2026-09-30';
export const OFFER_PUBLISHED_AT=process.env.OFFER_PUBLISHED_AT||null;
export const OFFER_SIGNED_AT=null; // This PDF has no embedded digital signature.
export const OFFER_DOCUMENT_SHA256='0c8e7036a52be9d1ff415a5a44f76743246e032aff0fe14300fa11f973e1a8eb';
export function offerDocumentMatches(root=fileURLToPath(new URL('../..',import.meta.url))){
 try{return createHash('sha256').update(readFileSync(join(root,'frontend/dist/documents/public-offer-aethermind.pdf'))).digest('hex')===OFFER_DOCUMENT_SHA256;}
 catch{return false;}
}

export const offerTariffs=[
  {nodeId:'NODE_4090',id:'ALPHA',name:'Node Alpha',depositUsdt:'50',days:30,dailyPercent:'1.50',dailyUsdt:'0.75',compoundPercent:'1.80',termPercent:'45',termYieldUsdt:'22.50',available:true},
  {nodeId:'NODE_A100',id:'BETA',name:'Cluster Beta',depositUsdt:'300',days:60,dailyPercent:'2.50',dailyUsdt:'7.50',compoundPercent:'3.00',termPercent:'150',termYieldUsdt:'450',available:true},
  {nodeId:'NODE_H100',id:'ENTERPRISE',name:'Enterprise POD',depositUsdt:'1200',days:90,dailyPercent:'3.50',dailyUsdt:'42.00',compoundPercent:'4.20',termPercent:'315',termYieldUsdt:'3780',available:true},
  {nodeId:'NODE_QBIT',id:'QUANTUM',name:'Quantum Array',depositUsdt:'5000',days:180,dailyPercent:null,dailyUsdt:null,compoundPercent:null,termPercent:null,termYieldUsdt:null,available:false}
] as const;

export type JourneyState='DONE'|'CURRENT'|'WAITING'|'LOCKED';
export type JourneyStep={id:'REGISTERED'|'TARIFF'|'FUNDED'|'ORDERED'|'WITHDRAW';title:string;description:string;state:JourneyState;available:boolean};
export function journey(input:{selected:boolean;funded:boolean;ordered:boolean;epochComplete:boolean;pendingOrder?:boolean;purchaseEnabled?:boolean}):JourneyStep[]{
  const {selected,funded,ordered,epochComplete,pendingOrder,purchaseEnabled=false}=input;
  return [
   {id:'REGISTERED',title:'Регистрация',description:'Профиль Telegram создан и защищён.',state:'DONE',available:true},
   {id:'TARIFF',title:'Выбор тарифа',description:selected?'Тариф сохранён в профиле.':'Выберите фиксированную категорию по оферте.',state:selected?'DONE':'CURRENT',available:true},
   {id:'FUNDED',title:'Пополнение',description:funded?'Ранее зачисленный баланс USDT.':'Новые пополнения приостановлены до согласования платёжных сетей с офертой.',state:funded?'DONE':selected?'WAITING':'WAITING',available:false},
   {id:'ORDERED',title:'Заказать тариф',description:ordered?'Оборудование заказано или активировано.':pendingOrder?'Заявка ожидает решения оператора.':purchaseEnabled?'Проверьте условия и подтвердите списание доступного баланса.':'Заказы тарифов пока приостановлены; средства остаются на балансе.',state:ordered?'DONE':purchaseEnabled&&funded?'CURRENT':'WAITING',available:purchaseEnabled},
   {id:'WITHDRAW',title:'Вывести средства',description:epochComplete?'Свободные средства можно вывести через заявку; оператор выполнит перевод вручную.':'Ранее зачисленные свободные средства можно вывести через заявку.',state:epochComplete?'CURRENT':'LOCKED',available:true}
  ];
}
