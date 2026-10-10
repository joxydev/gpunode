import {useEffect,useRef,useState,type CSSProperties} from 'react';
import './protected-art.css';
/** CSS artwork avoids Telegram's native image URL menu. Parent buttons remain clickable. */
export function ProtectedArt({src,srcSet,alt='',className='',width,height,loading='eager',lit}:{src:string;srcSet?:string;alt?:string;className?:string;width?:number|string;height?:number|string;loading?:'lazy'|'eager';sizes?:string;decoding?:string;draggable?:boolean;lit?:boolean}){
 const ref=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(loading!=='lazy');
 useEffect(()=>{if(visible||!ref.current)return;if(!('IntersectionObserver' in window)){setVisible(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'200px'});observer.observe(ref.current);return()=>observer.disconnect()},[visible]);
 const variants=srcSet?.split(',').map(item=>item.trim().split(/\s+/)),base=variants?.[0]?.[1]?parseFloat(variants[0][1]):1;
 const background=variants?.length?`image-set(${variants.map(([url,size])=>`url("${url}") ${parseFloat(size)/base}x`).join(',')})`:`url("${src}")`;
 const dimension=(value:number|string|undefined)=>value===undefined?undefined:typeof value==='number'||/^\d+(\.\d+)?$/.test(value)?`${value}px`:value;
 return <span ref={ref} className={`protected-art ${className}${lit===undefined?'':' fx-art'}`} data-image-protected data-fx-enabled={lit} role={alt?'img':undefined} aria-label={alt||undefined} aria-hidden={alt?undefined:true} style={{backgroundImage:visible?background:undefined,'--art-width':dimension(width),'--art-height':dimension(height)} as CSSProperties}/>;
}
