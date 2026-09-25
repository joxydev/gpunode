export type Feature={name:string;itemTypes?:readonly string[]};
export function tonCapabilities(wallet:{device?:{features?:readonly (Feature|string)[]}}|null|undefined,walletVersion:string|null|undefined,backendAvailable:boolean){
 const features=wallet?.device?.features||[];
 const named=(feature:Feature|string,name:string)=>typeof feature==='string'?feature===name:feature.name===name;
 const supportsSignMessage=features.some(feature=>named(feature,'SignMessage'));
 const supportsStructuredJetton=features.some(feature=>typeof feature!=='string'&&feature.name==='SendTransaction'&&feature.itemTypes?.includes('jetton'));
 return {supportsSignMessage,supportsStructuredJetton,gaslessCandidate:supportsSignMessage&&walletVersion==='W5'&&backendAvailable};
}
