import {useLanguage,languages,type Language} from './i18n';
import './privacy.css';

// LEGAL_REVIEW_REQUIRED: publish the final controller identity, contact and
// retention schedule after counsel reviews the product's actual operations.
export default function Privacy({embedded=false}:{embedded?:boolean}){
 const {t,language,choose}=useLanguage();
 return <article className={'privacy-page panel'+(embedded?' embedded':'')} lang={undefined}>
  {!embedded&&<label className="privacy-language">{t('Выберите язык')}<select value={language} onChange={event=>choose(event.target.value as Language)}>{languages.map(item=><option key={item.code} value={item.code}>{item.native}</option>)}</select></label>}
  <span className="eyebrow">AETHERMIND / LEGAL</span>
  <h1>{t('Политика конфиденциальности')}</h1>
  <p className="privacy-review">LEGAL_REVIEW_REQUIRED</p>
  <p>{t('Этот документ описывает обработку данных при использовании AetherMind. Юридические реквизиты и сроки хранения требуют окончательной проверки.')}</p>
  <h2>{t('Какие данные используются')}</h2>
  <p>{t('При входе через Telegram используются идентификатор, имя, username и данные авторизации. Для TON Proof обрабатывается адрес кошелька и подтверждение владения им. Для платежей сохраняются счёт, сумма, статус и идентификатор транзакции. Обращения в поддержку и настройки языка сохраняются в аккаунте.')}</p>
  <h2>{t('Зачем нужны данные')}</h2>
  <p>{t('Данные нужны для входа, подтверждения кошелька, учёта пополнений USDT TON, отображения состояния аккаунта, исполнения пользовательских запросов и ответа поддержки.')}</p>
  <h2>{t('Передача и безопасность')}</h2>
  <p>{t('Для подключения кошелька используется TON Connect; платежи проверяются по публичному блокчейну TON и сервисам индексирования. Публичные транзакции доступны в сети TON. Секретные ключи кошелька не запрашиваются.')}</p>
  <h2>{t('Ваши действия')}</h2>
  <p>{t('Вы можете отключить кошелёк, выйти из веб-сессии и обратиться в поддержку по вопросам данных. Удаление данных и сроки хранения уточняются в итоговой редакции документа.')}</p>
 </article>;
}
