import {languages,useLanguage} from './i18n';
import {Icon} from './Icons';
import './language.css';

export default function LanguagePicker(){const {choose}=useLanguage();return <main className="language-start"><div className="language-card panel"><img src="/assets/icons/icon-120.png" alt="AetherMind" width="72" height="72"/><span className="eyebrow">AETHERMIND</span><h1>Выберите язык<br/><small>Choose your language<br/>Alegeți limba</small></h1><div className="language-choices">{languages.map(({code,native})=><button className="language-choice" key={code} type="button" lang={code} onClick={()=>choose(code)}><span>{native}</span><span>{code.toUpperCase()} <Icon name="arrow" size={17}/></span></button>)}</div></div></main>}
