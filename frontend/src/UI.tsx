import {useId,type ReactNode} from 'react';
import {Icon} from './Icons';
import {exactMoney} from './exact-money';
import {useLanguage,intlLocale} from './i18n';

export function PageHeader({id,title,subtitle,onBack,backLabel,actions}:{id?:string;title:string;subtitle?:string;onBack?:()=>void;backLabel?:string;actions?:ReactNode}){
 return <header className="ui-page-header">{onBack&&<button className="ui-back text-button" onClick={onBack}><Icon name="back" size={20}/>{backLabel}</button>}<div><h1 id={id} tabIndex={-1}>{title}</h1>{subtitle&&<p>{subtitle}</p>}{actions&&<aside>{actions}</aside>}</div></header>;
}
export function Section({title,icon,actions,children,className=''}:{title?:string;icon?:string;actions?:ReactNode;children:ReactNode;className?:string}){
 const id=useId();return <section className={'ui-section '+className} aria-labelledby={title?id:undefined}>{title&&<header><h2 id={id}>{icon&&<Icon name={icon} size={20}/>} {title}</h2>{actions}</header>}{children}</section>;
}
export function IconContainer({name,tone='cyan',size=24}:{name:string;tone?:'cyan'|'violet'|'green'|'amber';size?:number}){return <span className={'ui-icon tone-'+tone}><Icon name={name} size={size}/></span>}
export function QuickAction({icon,label,onClick,disabled=false}:{icon:string;label:string;onClick:()=>void;disabled?:boolean}){return <button className="ui-quick-action" onClick={onClick} disabled={disabled}><IconContainer name={icon}/><span>{label}</span></button>}
export function FeatureTile({id,icon,label,onClick,tone='cyan'}:{id?:string;icon:string;label:string;onClick:()=>void;tone?:'cyan'|'violet'|'green'|'amber'}){return <button id={id} className="ui-feature-tile" onClick={onClick}><IconContainer name={icon} tone={tone}/><span>{label}</span></button>}
export function ListRow({icon,title,description,value,onClick,children,id}:{icon:string;title:string;description?:string;value?:ReactNode;onClick?:()=>void;children?:ReactNode;id?:string}){
 const contents=<><IconContainer name={icon}/><span className="ui-row-copy"><b>{title}</b>{description&&<small>{description}</small>}</span>{value&&<span className="ui-row-value">{value}</span>}{children}{onClick&&<Icon name="chevron" size={18}/>}</>;
 return onClick?<button id={id} className="ui-list-row" onClick={onClick}>{contents}</button>:<div id={id} className="ui-list-row">{contents}</div>;
}
export function StatusPill({label,status=''}:{label:string;status?:string}){const positive=['ACTIVE','OPERATIONAL','CREDITED','CONFIRMED','APPROVED','COMPLETED','DONE'].includes(status),negative=['FAILED','REJECTED','DEGRADED','DISABLED'].includes(status);return <span className={'ui-status '+(positive?'positive':negative?'negative':'waiting')}><Icon name={positive?'check':negative?'warning':'clock'} size={14}/>{label}</span>}
export function Money({value,currency=true,precision}:{value:string;currency?:boolean;precision?:6}){const {language}=useLanguage();return <span className="ui-money" title={value+(currency?' USDT':'')} data-amount={value}>{(value.startsWith('+')?'+':'')+exactMoney(value.replace(/^\+/,''),intlLocale(language),precision)}{currency&&<small> USDT</small>}</span>}
export function EmptyState({icon='node',title,description,action}:{icon?:string;title:string;description?:string;action?:ReactNode}){return <div className="ui-empty"><IconContainer name={icon} tone="violet"/><h3>{title}</h3>{description&&<p>{description}</p>}{action}</div>}
