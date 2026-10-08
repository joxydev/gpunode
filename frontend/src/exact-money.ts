/** Formatting and input normalization never round through a JS floating point number. */
export function normalizeCreditAmount(value:string){
 const clean=value.trim();if(!/^(0|[1-9]\d{0,12})([.,]\d{1,6})?$/.test(clean))return null;
 const [whole,fraction='']=clean.replace(',','.').split('.');
 const micros=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
 return micros>0n&&micros<=9223372036854775807n?whole+'.'+fraction.padEnd(6,'0'):null;
}
export function exactMoney(value:string,locale:string){
 const match=/^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(value||'0');if(!match)return '—';
 const formatter=new Intl.NumberFormat(locale),whole=formatter.format(BigInt(match[1]+match[2]));
 const fraction=(match[3]||'').replace(/0+$/,'');
 const separator=new Intl.NumberFormat(locale).formatToParts(1.1).find(p=>p.type==='decimal')?.value||'.';
 const minus=match[1]&&BigInt(match[2])===0n&&/[1-9]/.test(fraction)?formatter.formatToParts(-1).find(p=>p.type==='minusSign')?.value||'-':'';
 return minus+whole+(fraction?separator+fraction:'');
}
