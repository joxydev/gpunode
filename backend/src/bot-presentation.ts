export type BotLanguage='ru'|'en'|'ro';
export type BotCommand='/start'|'/help'|'/support'|'/terms'|'/paysupport';
export const WELCOME_PHOTO='attach://welcome';
export function botLanguage(value?:string|null):BotLanguage{return value?.toLowerCase().startsWith('ro')?'ro':value?.toLowerCase().startsWith('en')?'en':'ru';}
export function escapeHtml(value:string){return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
export const botWords={
 ru:{approve:'✅ Вход подтверждён. Вернитесь в браузер.',reject:'Вход отклонён.',stale:'Запрос уже обработан или истёк.',login:'🔐 Вход в AetherMind',code:'Код запроса',check:'Сверьте код с открытой вкладкой. Подтверждайте только вход, который вы начали сами.\n\nПосле подтверждения вернитесь в ту же вкладку.',expired:'⌛ <b>Запрос входа истёк</b>\n\nОн уже обработан или больше не действует. Начните вход заново в браузере.',confirm:'✅ Подтвердить вход',deny:'Отклонить',open:'🚀 Открыть AetherMind'},
 en:{approve:'✅ Sign-in confirmed. Return to your browser.',reject:'Sign-in rejected.',stale:'Request already processed or expired.',login:'🔐 AetherMind sign-in',code:'Request code',check:'Compare the code with your browser tab. Only confirm sign-ins you started.\n\nAfter confirming, return to the same tab.',expired:'⌛ <b>Sign-in request expired</b>\n\nIt has already been processed or is no longer valid. Start again in your browser.',confirm:'✅ Confirm sign-in',deny:'Reject',open:'🚀 Open AetherMind'},
 ro:{approve:'✅ Autentificarea a fost confirmată. Revino în browser.',reject:'Autentificarea a fost refuzată.',stale:'Cererea a fost deja procesată sau a expirat.',login:'🔐 Autentificare AetherMind',code:'Codul cererii',check:'Compară codul cu cel din fila de browser. Confirmă doar autentificările inițiate de tine.\n\nDupă confirmare, revino în aceeași filă.',expired:'⌛ <b>Cererea de autentificare a expirat</b>\n\nA fost deja procesată sau nu mai este valabilă. Începe din nou în browser.',confirm:'✅ Confirmă autentificarea',deny:'Refuză',open:'🚀 Deschide AetherMind'}
};
const messages={
 ru:{
  start:'👋 <b>Добро пожаловать в AetherMind!</b>\n\n{name}Участие в коммерческом DePIN-кластере GPU — прямо в Telegram.\n\n🖥 <b>Всё в одном приложении</b>\n• GPU-тарифы и этапы ваших договоров\n• Баланс и история операций\n• Партнёрская программа и поддержка\n\n🚀 <b>С чего начать</b>\n1. Откройте приложение кнопкой ниже.\n2. Ознакомьтесь с публичной офертой и примите её.\n3. Выберите тариф и следуйте подсказкам в профиле.\n\nНужна помощь? /help',
  terms:'📄 <b>Условия AetherMind</b>\n\n🖥 <b>Действующие GPU-тарифы</b>\n• Node Alpha — <b>50 USDT</b>\n• Cluster Beta — <b>300 USDT</b>\n• Enterprise POD — <b>1 200 USDT</b>\n\nQuantum Array находится в разработке.\n\n💳 <b>Пополнение и вывод</b>\nПополнение USDT в сети TON — по инвойсу из приложения. Заявки на вывод рассматривает оператор.\n\n📑 <b>Публичная оферта</b>\nПолные условия, сроки и параметры договоров доступны в приложении. Перед участием ознакомьтесь с действующей офертой и примите её.',
  support:'🎧 <b>Поддержка AetherMind</b>\n\n<b>Как обратиться</b>\n1. Откройте приложение кнопкой ниже.\n2. Нажмите значок наушников.\n3. Выберите тему и опишите ваш вопрос.\n\n💬 <b>Где смотреть ответ</b>\nОбращения и ответы сохраняются в вашем профиле. Вы сможете продолжить разговор в том же обращении.',
  help:'🧭 <b>Навигация по AetherMind</b>\n\n<b>Основное — в приложении</b>\nGPU-тарифы, баланс, договоры и партнёрская статистика доступны по кнопке ниже.\n\n<b>Команды бота</b>\n/start — приветствие и запуск\n/terms — условия и тарифы\n/support — обращение в поддержку\n/paysupport — помощь по платежам\n/help — эта подсказка\n\nНачните с приложения: оно покажет следующий шаг для вашего профиля.'
 },
 en:{
  start:'👋 <b>Welcome to AetherMind!</b>\n\n{name}Join the commercial DePIN GPU cluster — directly in Telegram.\n\n🖥 <b>Everything in one app</b>\n• GPU plans and contract progress\n• Balance and transaction history\n• Partner program and support\n\n🚀 <b>Getting started</b>\n1. Open the app using the button below.\n2. Read and accept the public offer.\n3. Choose a plan and follow your profile’s next steps.\n\nNeed help? /help',
  terms:'📄 <b>AetherMind terms</b>\n\n🖥 <b>Available GPU plans</b>\n• Node Alpha — <b>50 USDT</b>\n• Cluster Beta — <b>300 USDT</b>\n• Enterprise POD — <b>1,200 USDT</b>\n\nQuantum Array is in development.\n\n💳 <b>Deposits and withdrawals</b>\nDeposit USDT on TON using an invoice from the app. Withdrawal requests are reviewed by an operator.\n\n📑 <b>Public offer</b>\nFull terms, durations and contract parameters are available in the app. Read and accept the current offer before participating.',
  support:'🎧 <b>AetherMind support</b>\n\n<b>How to contact us</b>\n1. Open the app using the button below.\n2. Tap the headphones icon.\n3. Choose a topic and describe your question.\n\n💬 <b>Where to find the reply</b>\nYour messages and replies are saved in your profile. Continue the conversation in the same support ticket.',
  help:'🧭 <b>AetherMind navigation</b>\n\n<b>Your main features are in the app</b>\nGPU plans, balance, contracts and partner statistics are available using the button below.\n\n<b>Bot commands</b>\n/start — welcome and launch\n/terms — terms and plans\n/support — contact support\n/paysupport — payment support\n/help — this guide\n\nStart with the app: your profile will show the next step.'
 },
 ro:{
  start:'👋 <b>Bun venit în AetherMind!</b>\n\n{name}Participă la clusterul GPU DePIN comercial — direct în Telegram.\n\n🖥 <b>Totul într-o singură aplicație</b>\n• Planuri GPU și etapele contractelor\n• Sold și istoricul operațiunilor\n• Program de parteneriat și asistență\n\n🚀 <b>Primii pași</b>\n1. Deschide aplicația cu butonul de mai jos.\n2. Citește și acceptă oferta publică.\n3. Alege un plan și urmează indicațiile din profil.\n\nAi nevoie de ajutor? /help',
  terms:'📄 <b>Condiții AetherMind</b>\n\n🖥 <b>Planuri GPU disponibile</b>\n• Node Alpha — <b>50 USDT</b>\n• Cluster Beta — <b>300 USDT</b>\n• Enterprise POD — <b>1 200 USDT</b>\n\nQuantum Array este în dezvoltare.\n\n💳 <b>Depuneri și retrageri</b>\nDepune USDT în rețeaua TON folosind o factură din aplicație. Cererile de retragere sunt analizate de operator.\n\n📑 <b>Oferta publică</b>\nCondițiile complete, duratele și parametrii contractelor sunt disponibili în aplicație. Citește și acceptă oferta actuală înainte de participare.',
  support:'🎧 <b>Asistență AetherMind</b>\n\n<b>Cum ne contactezi</b>\n1. Deschide aplicația cu butonul de mai jos.\n2. Apasă pictograma cu căști.\n3. Alege un subiect și descrie întrebarea.\n\n💬 <b>Unde găsești răspunsul</b>\nMesajele și răspunsurile sunt salvate în profilul tău. Poți continua conversația în aceeași solicitare.',
  help:'🧭 <b>Navigare AetherMind</b>\n\n<b>Funcțiile principale sunt în aplicație</b>\nPlanurile GPU, soldul, contractele și statisticile parteneriatului sunt disponibile prin butonul de mai jos.\n\n<b>Comenzile botului</b>\n/start — bun venit și lansare\n/terms — condiții și planuri\n/support — contactează asistența\n/paysupport — asistență pentru plăți\n/help — acest ghid\n\nÎncepe cu aplicația: profilul îți va indica pasul următor.'
 }
};
export function botCommand(text:string):BotCommand|null{
 const command=text.split(/[\s@]/)[0];
 return ['/start','/help','/terms','/support','/paysupport'].includes(command)?command as BotCommand:null;
}
export function botReply(command:BotCommand,language:BotLanguage,chatId:number,publicUrl:string,firstName?:string){
 const key=command==='/paysupport'?'support':command.slice(1) as 'start'|'help'|'terms'|'support';
 const name=firstName?escapeHtml(Array.from(firstName.trim()).slice(0,60).join('')):'';
 const greeting={ru:'рады видеть вас здесь!',en:'glad to have you here!',ro:'ne bucurăm să te vedem aici!'};
 const text=messages[language][key].replace('{name}',name?`<b>${name}</b>, ${greeting[language]}\n\n`:'');
 const common={chat_id:chatId,parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:botWords[language].open,web_app:{url:publicUrl.replace(/\/$/,'')+'/'}}]]}};
 return command==='/start'?{method:'sendPhoto',body:{...common,photo:WELCOME_PHOTO,caption:text}}:{method:'sendMessage',body:{...common,text,link_preview_options:{is_disabled:true}}};
}
export function browserLoginText(language:BotLanguage,publicUrl:string,code:string,bound:boolean){
 const copy=botWords[language];
 return bound?`<b>${copy.login}</b>\n\n${escapeHtml(publicUrl)}\n\n<b>${copy.code}:</b> <code>${escapeHtml(code)}</code>\n\n${copy.check}`:copy.expired;
}
