export const OFFER_NUMBER='88/2026-AI';
export const OFFER_VERSION='88-2026-AI-2026-09-21';
export const OFFER_PUBLISHED_AT='2026-09-14';
export const OFFER_SIGNED_AT='2026-09-21';
export const OFFER_DOCUMENT_SHA256='b21177972dbdeedbea731e826b070ff7fb148ec1f96e7892536e67e40732ce88';

export const offerTariffs=[
  {nodeId:'NODE_4090',id:'ALPHA',name:'Node Alpha',depositUsdt:'50',days:30,dailyPercent:'1.50',dailyUsdt:'0.75',compoundPercent:'1.80',termPercent:'45',termYieldUsdt:'22.50',available:true},
  {nodeId:'NODE_A100',id:'BETA',name:'Cluster Beta',depositUsdt:'300',days:60,dailyPercent:'2.50',dailyUsdt:'7.50',compoundPercent:'3.00',termPercent:'150',termYieldUsdt:'450',available:true},
  {nodeId:'NODE_H100',id:'ENTERPRISE',name:'Enterprise POD',depositUsdt:'1200',days:90,dailyPercent:'3.50',dailyUsdt:'42.00',compoundPercent:'4.20',termPercent:'315',termYieldUsdt:'3780',available:true},
  {nodeId:'NODE_QBIT',id:'QUANTUM',name:'Quantum Array',depositUsdt:'5000',days:180,dailyPercent:null,dailyUsdt:null,compoundPercent:null,termPercent:null,termYieldUsdt:null,available:false}
] as const;

export type JourneyState='DONE'|'CURRENT'|'WAITING'|'LOCKED';
export type JourneyStep={id:'REGISTERED'|'TARIFF'|'FUNDED'|'ORDERED'|'WITHDRAW';title:string;description:string;state:JourneyState;available:boolean};
export function journey(input:{selected:boolean;funded:boolean;ordered:boolean;epochComplete:boolean}):JourneyStep[]{
  const {selected,funded,ordered,epochComplete}=input;
  return [
    {id:'REGISTERED',title:'Регистрация',description:'Профиль Telegram создан и защищён.',state:'DONE',available:true},
    {id:'TARIFF',title:'Выбор тарифа',description:selected?'Тариф сохранён в профиле.':'Выберите фиксированную категорию по оферте.',state:selected?'DONE':'CURRENT',available:true},
    {id:'FUNDED',title:'Пополнение',description:funded?'Депозит подтверждён в учётном балансе.':'Будет доступно после подключения платёжного провайдера.',state:funded?'DONE':selected?'CURRENT':'WAITING',available:false},
    {id:'ORDERED',title:'Заказать тариф',description:ordered?'Слот активирован, Epoch запущен.':'Заказ станет доступен после подтверждения депозита.',state:ordered?'DONE':funded?'CURRENT':'WAITING',available:false},
    {id:'WITHDRAW',title:'Вывести средства',description:epochComplete?'Epoch завершён; вывод станет доступен после подключения выплат.':'После окончания срока выбранного тарифа.',state:epochComplete?'CURRENT':'LOCKED',available:false}
  ];
}
