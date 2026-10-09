import type {LiveAccrual} from './api';
export function liveAmounts(snapshot:LiveAccrual,now:number){
 const start=Date.parse(snapshot.periodStart||''),end=Date.parse(snapshot.periodEnd||'');
 const active=snapshot.state==='ACTIVE'&&snapshot.validSnapshot&&Number.isFinite(start)&&Number.isFinite(end)&&end>start;
 const seconds=active?Math.min(86400,Math.max(0,Math.floor((now-start)/1000))):0;
 const daily=BigInt(snapshot.dailyYieldMicros),s=BigInt(seconds),interval=s/10n;
 const current=active?daily*s/86400n:0n;
 const delta=active&&interval>0n?daily*interval/8640n-daily*(interval-1n)/8640n:0n;
 return {current,delta,daily,seconds,remaining:active?Math.max(0,Math.ceil((end-now)/1000)):0,
  progress:seconds/86400,boundary:active&&now>=end,
  total:BigInt(snapshot.confirmedProfitMicros)+BigInt(snapshot.pendingProfitMicros)+current};
}
export function microDecimal(amount:bigint){return `${amount/1000000n}.${(amount%1000000n).toString().padStart(6,'0')}`;}
export function timerText(seconds:number){const s=Math.max(0,seconds);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');}

/** Monotonic server clock; device Date.now() never drives money. One shared timer. */
export class ServerClock{
 private anchor=0;private at=0;private version=-1;private active=true;private interval:ReturnType<typeof setInterval>|null=null;
 private listeners=new Set<()=>void>();private value={now:0,ready:false};
 constructor(private monotonic=()=>performance.now()){}
 getSnapshot=()=>this.value;
 sync(serverNow:string,sent:number,received:number){
  const server=Date.parse(serverNow);if(!Number.isFinite(server)||server<this.version)return false;
  this.version=server;this.anchor=server+Math.min(1000,Math.max(0,received-sent)/2);this.at=received;
  this.value={now:this.anchor,ready:this.active};this.emit();this.schedule();return true;
 }
 setActive(active:boolean){if(this.active===active)return;this.active=active;this.value={...this.value,ready:false};this.emit();this.schedule();}
 reset(){this.version=-1;this.anchor=0;this.at=0;this.value={now:0,ready:false};this.emit();this.schedule();}
 tick=()=>{if(!this.active||!this.value.ready)return;const elapsed=Math.max(0,this.monotonic()-this.at);
  this.value=elapsed>90000?{...this.value,ready:false}:{now:this.anchor+elapsed,ready:true};this.emit();this.schedule();};
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);this.schedule();return()=>{this.listeners.delete(listener);this.schedule()};};
 private emit(){this.listeners.forEach(listener=>listener());}
 private schedule(){if(this.interval&&(!this.listeners.size||!this.active||!this.value.ready)){clearInterval(this.interval);this.interval=null;}
  if(!this.interval&&this.listeners.size&&this.active&&this.value.ready)this.interval=setInterval(this.tick,1000);}
}
export const serverClock=new ServerClock();
export function workloadFrame(id:string,nodeId:string,now:number){
 let seed=0;for(const char of id)seed=(seed*31+char.charCodeAt(0))>>>0;
 const segment=Math.floor(now/6000),stage=((segment+seed)%3+3)%3;
 return {load:[56,76,67][stage]+((seed+Math.floor(segment/3)*17)%9)-4,progress:[24,68,96][stage],stage,
  task:((seed+Math.floor(segment/3))%3+3)%3,category:nodeId==='NODE_4090'?'alpha':nodeId==='NODE_A100'?'beta':'enterprise'};
}
