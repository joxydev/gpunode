import {readFile,writeFile} from 'node:fs/promises';

const file=new URL('../dist/tonconnect-manifest.json',import.meta.url);
const manifest=JSON.parse(await readFile(file,'utf8'));
const origin=process.env.AETHERMIND_PUBLIC_ORIGIN?.replace(/\/$/,'')||new URL(manifest.url).origin;
const url=new URL(origin);
if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash)throw Error('AETHERMIND_PUBLIC_ORIGIN must be an HTTPS origin');
for(const key of ['url','iconUrl','termsOfUseUrl','privacyPolicyUrl']){
 const original=new URL(manifest[key]);
 manifest[key]=new URL(original.pathname+original.search,url).href;
}
await writeFile(file,JSON.stringify(manifest,null,2)+'\n');
