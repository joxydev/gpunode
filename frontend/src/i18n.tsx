import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {translations} from './translations';

export type Language='ru'|'en'|'ro';
export const languages:{code:Language;name:string;native:string}[]=[
 {code:'ru',name:'Russian',native:'Русский'},
 {code:'en',name:'English',native:'English'},
 {code:'ro',name:'Romanian',native:'Română'}
];
const storageKey='aethermind.language.v1';
const valid=(value:unknown):value is Language=>value==='ru'||value==='en'||value==='ro';
function stored():Language|null{try{const value=localStorage.getItem(storageKey);return valid(value)?value:null}catch{return null}}
export const browserLanguage=()=>stored();
export const intlLocale=(language:Language)=>({ru:'ru-RU',en:'en-US',ro:'ro-RO'})[language];

// The Russian source is the fallback. All user-facing copy uses these same keys.

type LanguageState={language:Language;chosen:boolean;choose:(language:Language)=>void;t:(source:string,values?:Record<string,string|number>)=>string};
const Context=createContext<LanguageState|null>(null);
export function LanguageProvider({children}:{children:ReactNode}){
 const [language,setLanguage]=useState<Language>(()=>stored()||'ru');
 const [chosen,setChosen]=useState(()=>Boolean(stored()));
 const choose=(next:Language)=>{setLanguage(next);setChosen(true);try{localStorage.setItem(storageKey,next)}catch{/* private mode */}};
 useEffect(()=>{document.documentElement.lang=language;document.title='AetherMind · '+({ru:'Вычислительная сеть',en:'Compute Network',ro:'Rețea de calcul'}[language]);document.querySelector('meta[name="description"]')?.setAttribute('content',({ru:'AetherMind — участие в вычислительной сети GPU.',en:'AetherMind — take part in a GPU compute network.',ro:'AetherMind — participă la o rețea de calcul GPU.'})[language])},[language]);
 const t=(source:string,values?:Record<string,string|number>)=>{
   const translation=language==='ru'?source:translations[source]?.[language==='en'?0:1]||source;
   return values?translation.replace(/\{([a-zA-Z]+)\}/g,(_,key:string)=>String(values[key]??'{'+key+'}')):translation;
 };
 return <Context.Provider value={{language,chosen,choose,t}}>{children}</Context.Provider>;
}
export function useLanguage(){const value=useContext(Context);if(!value)throw Error('LanguageProvider missing');return value}
