import {useLanguage} from './i18n';
import {useEffect,useState} from 'react';
import {api} from './api';
type Challenge={id:string;secret:string;code:string;url:string;expiresAt:string};
export default function BrowserLogin({onSuccess}:{onSuccess:(token:string)=>Promise<void>}){
 const {t}=useLanguage();
 const [challenge,setChallenge]=useState<Challenge|null>(null),[error,setError]=useState(''),[ended,setEnded]=useState(false),[generation,setGeneration]=useState(0);
 useEffect(()=>{
  let active=true,timer:ReturnType<typeof setTimeout>|undefined,c:Challenge|null=null,approvedToken='';
  setChallenge(null);setError('');setEnded(false);
  const poll=async()=>{
   if(!active||!c)return;
   if(Date.now()>=Date.parse(c.expiresAt)){setEnded(true);return;}
   if(document.visibilityState==='hidden'){timer=setTimeout(poll,2500);return;}
   try{if(approvedToken){await onSuccess(approvedToken);return;}
    const result=await api('/auth/browser/poll',{id:c.id,secret:c.secret});if(!active)return;
    if(result.status==='APPROVED'){approvedToken=result.token;await onSuccess(approvedToken);return;}
    if(result.status==='DENIED'||result.status==='EXPIRED'){setError(result.status==='DENIED'?t('Вход отклонён в Telegram.'):t('Срок запроса истёк.'));setEnded(true);return;}
    setError('');
   }catch(e){if(!active)return;setError((e as Error).message);}
   if(active)timer=setTimeout(poll,2500);
  };
  void api<Challenge>('/auth/browser/start',{}).then(result=>{if(!active)return;c=result;setChallenge(result);timer=setTimeout(poll,1500);}).catch(e=>{if(active){setError(e.message);setEnded(true);}});
  return()=>{active=false;if(timer)clearTimeout(timer);};
 },[generation]);
 return <><span className="eyebrow">{t("TELEGRAM LOGIN")}</span><h2>{t("Вход в аккаунт")}</h2><p>{t("Откройте бота, нажмите «Запустить» и подтвердите вход с этим кодом. Затем вернитесь в эту вкладку.")}</p>{challenge&&!ended&&<><div className="browser-login-code" aria-label={t("Код запроса")}>{challenge.code}</div><a className="primary wide" href={challenge.url} target="_blank" rel="noopener noreferrer">{t("Подтвердить через Telegram")}</a><p className="fine">{t("Запрос действует 5 минут. Не подтверждайте вход по чужим ссылкам.")}</p><p role="status">{t("Ожидаем подтверждение…")}</p></>}{!challenge&&!ended&&<p role="status">{t("Создаём запрос…")}</p>}{error&&<p role="alert">{error}</p>}{ended&&<button className="secondary wide" onClick={()=>setGeneration(n=>n+1)}>{t("Начать вход заново")}</button>}</>;
}
