import {useLanguage} from './i18n';
import './stellar.css';

/** The source artwork never moves. Three bounded overlays animate only the central star. */
export default function CoreVisual({activeView=true}:{activeView?:boolean}){
 const {t}=useLanguage();
 return <div className="core-visual stellar-visual" onContextMenu={e=>e.preventDefault()}><div className="stellar-scene" data-fx-enabled={activeView} role="img" aria-label={t("Неподвижная нейронная звезда мягко мерцает на фоне космического неба")}><div className="stellar-sky"/><div className="stellar-dimmer"/><div className="stellar-light"/><div className="stellar-flare"/></div><span className="core-caption"><i/> LIVE NEURAL CORE</span></div>
}
