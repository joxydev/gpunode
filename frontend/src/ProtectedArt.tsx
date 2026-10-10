import {useEffect,useRef,useState,type CSSProperties} from 'react';
import './protected-art.css';
/** CSS artwork avoids Telegram's native image URL menu. Parent buttons remain clickable. */
export function ProtectedArt({src,srcSet,alt='',className='',width,height,loading='eager'}:{src:string;srcSet?:string;alt?:string;className?:string;width?:number|string;height?:number|string;loading?:'lazy'|'eager';sizes?:string;decoding?:string;draggable?:boolean}){
 const ref=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(loading!=='lazy');
 useEffect(()=>{if(visible||!ref.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'200px'});observer.observe(ref.current);return()=>observer.disconnect()},[visible]);
 const variants=srcSet?.split(',').map(item=>item.trim().split(/\s+/)),base=variants?.[0]?.[1]?parseFloat(variants[0][1]):1;
 const background=variants?.length?`image-set(${variants.map(([url,size])=>`url("${url}") ${parseFloat(size)/base}x`).join(',')})`:`url("${src}")`;
 return <span ref={ref} className={`protected-art ${className}`} data-image-protected role={alt?'img':undefined} aria-label={alt||undefined} aria-hidden={alt?undefined:true} style={{backgroundImage:visible?background:undefined,'--art-width':width?`${width}px`:undefined,'--art-height':height?`${height}px`:undefined} as CSSProperties}/>;
}
