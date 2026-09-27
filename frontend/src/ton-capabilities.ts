export type Feature={name:string;maxMessages?:number;itemTypes?:readonly string[]};
export function tonCapabilities(wallet:{device?:{features?:readonly (Feature|string)[]}}|null|undefined,walletVersion:string|null|undefined,backendAvailable:boolean){
 const features=wallet?.device?.features||[];
 const named=(feature:Feature|string,name:string)=>typeof feature==='string'?feature===name:feature.name===name;
 // TONAPI returns two messages: the relayer's USDT fee and the invoice transfer.
 // A wallet advertising only one SignMessage action cannot sign this quote.
 const supportsSignMessage=features.some(feature=>typeof feature!=='string'&&feature.name==='SignMessage'&&
  typeof feature.maxMessages==='number'&&Number.isInteger(feature.maxMessages)&&feature.maxMessages>=2);
 const supportsStructuredJetton=features.some(feature=>typeof feature!=='string'&&feature.name==='SendTransaction'&&feature.itemTypes?.includes('jetton'));
 return {supportsSignMessage,supportsStructuredJetton,gaslessCandidate:supportsSignMessage&&walletVersion==='W5'&&backendAvailable};
}
