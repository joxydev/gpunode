# Оформление Telegram-бота AetherMind — 108/109

## Задача и план выполнения

Обновить сам Telegram-бот в стиле действующего AetherMind: приветствие с изображением, структурированные ответы команд и удобный запуск Mini App. Сохранить приглашения, язык профиля, защищённый webhook и подтверждение входа из браузера. Передавать изображение как файл, без ссылки на картинку в сообщении. Проверить штатный способ включения главного Mini App для нативной кнопки запуска в клиенте Telegram.

1. Проверить текущие обработчики `/start`, `/terms`, `/support`, `/paysupport`, язык профиля и настройки Bot API.
2. Создать баннер с тёмным фоном, голубыми и фиолетовыми акцентами, GPU-модулями и символом AetherMind; оптимизировать файл для Telegram.
3. Добавить приветствие с изображением и кнопкой запуска. Оформить ответы на RU/EN/RO: заголовок, пустые строки, жирное выделение основного, понятные шаги и умеренные эмодзи. Добавить `/help`.
4. Проверить HTML-экранирование имени пользователя и кода входа, лимиты подписи и сообщений. Сохранить обработку приглашений и подтверждений.
5. Обновить настройку команд, описания профиля и кнопки меню; читать настройки обратно для проверки. Через `getMe.has_main_web_app` показать состояние главного Mini App и конкретный следующий шаг в BotFather.
6. Проверить HTTP-сценарии на отдельной базе и имитировать только Telegram transport. Подготовить два последовательных файла обновления: GitHub без автоматической сборки Actions, затем VPS с проверками и бэкапом.

Все пункты выполнены в коде. Настройка живого бота выполняется файлом 109 после установки; главное Mini App включается владельцем в BotFather, если оно ещё выключено.

## Поведение после установки

- `/start`: баннер, приветствие с именем, краткое введение, возможности приложения, три начальных шага и кнопка «Открыть AetherMind».
- `/help`: основные функции и полный список команд.
- `/terms`: тарифы отдельными строками, пополнение и вывод, публичная оферта.
- `/support` и `/paysupport`: пошаговое обращение и место хранения ответов.
- Вход из браузера: отдельный заголовок, выделенный код, проверка запроса и две кнопки подтверждения/отклонения.
- Язык обычных команд: сохранённый язык профиля; для нового пользователя — язык Telegram с русским как резервным.
- Баннер загружается методом `sendPhoto` через multipart; последующие приветствия используют Telegram `file_id`. Сбой сети возвращает ошибку webhook для повтора Telegram. При недействительном кэшированном `file_id` выполняется одна новая загрузка.

## Кнопка запуска, как на скриншоте

Кнопка под сообщением, кнопка меню чата и нативная кнопка клиента — разные места запуска.

Файл 109 автоматически устанавливает кнопку меню «Открыть», команды и описания RU/EN/RO. Для главного приложения владелец открывает [BotFather](https://t.me/BotFather):

`/mybots → ваш бот → Bot Settings → Configure Mini App → Enable Mini App`

Адрес: `https://31.77.226.26/` (либо актуальный PUBLIC_URL, напечатанный установкой).

Если главное приложение уже включено, повторно включать его не нужно. Установка проверяет `getMe.has_main_web_app`; окончательное расположение нативной кнопки, включая список чатов, задаёт версия клиента Telegram. Сама настройка Main Mini App в BotFather не выполняется методом Bot API.

Проверка после настройки на VPS:

```bash
sudo python3 /srv/apps/gpunode/current/ops/bot-config.py --check-main-app
```

Документация Telegram: [Main Mini App](https://core.telegram.org/bots/webapps#launching-the-main-mini-app), [getMe](https://core.telegram.org/bots/api#getme), [sendPhoto](https://core.telegram.org/bots/api#sendphoto).

## Изображение

Файл проекта: `frontend/public/assets/bot/welcome.jpg`, JPEG 1279×720, 169794 байта.
SHA256: `fb0629877727117170f95ce25c4ea32eae7c2cfd249cd6f2c1eecd496ef2c9b6`.
Способ создания: встроенный imagegen. Исходный промпт:

> Create a polished landscape 16:9 welcome banner for the existing AetherMind Telegram GPU DePIN mini application. Dark almost black navy #050816 background, restrained cyan #26e6ff and violet luminous accents, premium realistic 3D product illustration. In the center a sculptural metallic capital A / triangular energy core with a small glowing neural sphere, orbiting thin cyan light rings; behind it elegantly arranged dark titanium GPU compute modules and hints of a distributed network on the horizon. Symmetric calm composition with generous dark breathing room around the central subject, sharp premium material texture, subtle reflections, tasteful studio lighting and low bloom, refined sci-fi engineering aesthetic, strong legibility at mobile thumbnail size. Avoid busy starfields, money, coins, charts, people, watermark, any text or lettering other than the abstract sculptural triangular A shape. The banner will sit above a Telegram greeting caption; no embedded interface or typography. Opaque background.

## Установка

Скачать оба файла полностью в Download и выполнить в Termux по очереди:

```bash
bash ~/storage/downloads/108_aethermind_bot_github.sh
bash ~/storage/downloads/109_aethermind_bot_vps.sh
```

108 сохраняет локальные изменения, объединяет обычным merge проверенный коммит с актуальным main, отправляет обычным push и сохраняет точный SHA для 109. 109 делает бэкап, сборку, тесты, интеграционные проверки на отдельной PostgreSQL, проверку баннера через Nginx и обновляет настройки бота.

Настройка Telegram выполняется после проверок приложения. Если Telegram временно недоступен, работающий новый релиз остаётся на VPS; установка сообщает сбой внешней настройки. Повторить только:

```bash
sudo python3 /srv/apps/gpunode/current/ops/bot-config.py
```

## Проверки и пределы

Локально: 59 backend + 6 frontend тестов, 5 тестов настройки Bot API, 10 проверок деплоя; сборки backend/frontend и HTTP-проверки webhook на отдельной PGlite с PostgreSQL wire protocol. Проверены реальные маршруты Nest/Prisma, все команды, языки, приоритет языка профиля, приглашение, повтор update, приватный чат, загрузка/кэш баннера и браузерное подтверждение. Telegram заменён тестовым transport; сообщения настоящим пользователям не отправлялись.

На VPS файл 109 дополнительно выполняет полный существующий интеграционный набор на настоящей отдельной PostgreSQL и проверяет реальные настройки Bot API. Развёртывание на VPS и вид кнопки на телефоне из этой среды не выполнялись.
