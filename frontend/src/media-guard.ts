/** Capture also covers consent gates, language selection and third-party portal images. */
export function installMediaGuard(root:Document){
 const prevent=(event:Event)=>{const target=event.target;if(target instanceof Element&&target.closest('img,picture,[data-image-protected],.core-visual'))event.preventDefault()};
 root.addEventListener('contextmenu',prevent,true);root.addEventListener('dragstart',prevent,true);
 return()=>{root.removeEventListener('contextmenu',prevent,true);root.removeEventListener('dragstart',prevent,true)};
}
