# AetherMind · Market v1

Этап: визуальный каталог и подготовка хранения контрактов. Выпуск обновляет существующее приложение; аккаунты, обращения, заявки и журнал денег сохраняются.

## Что работает

- Каталог из PostgreSQL: Consumer, Enterprise, Quantum, Tier 1–4.
- Фильтрация и сортировка на сервере; цена и APR в обе стороны, уровень в обе стороны.
- Карточки, детальное окно, профиль и заявка без оплаты. Авторизация — существующая Telegram HMAC-сессия.
- Остатки и состояния Available, Limited (≤20%), Sold Out; неизвестный пул отличается от заполненного.
- Автообновление каталога каждые 30 секунд только в видимой вкладке, повтор загрузки после ошибки, защита от устаревших ответов.
- 36 изображений: для каждой из четырёх нод WebP 160/320/480 и 360/720/1080, PNG 40/80/120.

## Контракты и учёт

Параметры 50/300/1200/5000 USDT и 3.5/5/6.5/8.5% взяты из ТЗ как проект будущих условий. Они не означают действующие договоры, гарантированный доход или фактическую загрузку. APR = дневная ставка ×365 без сложного процента; расчёт за срок = дневная сумма × число дней, без комиссий. Возврат стоимости в расчёт не включён и требует договорных условий.

Миграция только добавляет `gpu_catalog` и `user_leases`. В исходном приложении User.id — текстовый Telegram ID: он сохранён. Денежные операции остаются в едином `LedgerEntry` (целые микро-USDT); отдельная конкурирующая таблица balances/transactions не создаётся. Заявленные в ТЗ PURCHASE / DAILY_YIELD / REFERRAL_BONUS могут храниться как `kind`; в этом выпуске начислений нет.

`GET /api/v1/market?category=ALL&sort=tier_asc`, `GET /api/v1/market/:id` — публичные. `GET /api/v1/market/leases` — только свои договоры. `POST /api/v1/market/buy` требует авторизации и отвечает 503 CONTRACTS_NOT_CONNECTED: оплаченная аренда закрыта на сервере, независимо от интерфейса.

Подготовлен и проверен `reserveLease` — ядро будущей ACID-транзакции: блокировка User, затем GPU, повтор по idempotency key, проверка баланса/пула/лимита, snapshot условий, lease со статусом PROVISIONING, списание в существующем ledger и audit. Вызывать только внутри одной PostgreSQL-транзакции. Сейчас HTTP-контроллер его не вызывает. Все будущие денежные операции обязаны блокировать ту же строку User. Одной переменной окружения недостаточно, чтобы включить продажи.

Следующий этап: отдельная сущность версионируемого договора в админке, привязка к GPU, проверенный пул, источник фактических задач и выручки, provisioning/outbox, идемпотентное распределение выручки, возвраты и условия завершения. Затем — платёжный поток и push/WebSocket по подтверждённым событиям. Симуляция растущего баланса, фиктивные задачи и автодоход не добавлены.

## Показатели оборудования

- RTX4090: 24 GB GDDR6X, FP32 82.6 округлено до 83 TFLOPS. [NVIDIA Ada architecture](https://images.nvidia.com/aem-dam/Solutions/geforce/ada/nvidia-ada-gpu-architecture.pdf).
- A100: 80 GB HBM2e, 312 TFLOPS BF16/FP16 Tensor без sparsity. [NVIDIA A100](https://www.nvidia.com/en-us/data-center/a100/).
- H100 SXM: 80 GB HBM3, BF16 Tensor **со sparsity** 1979 округлено в карточке до 2000. [NVIDIA H100](https://www.nvidia.com/en-us/data-center/h100/).
- Quantum / Photonic Array / 50000 TFLOPS — заданная концепция, не проверенная характеристика реальной арендуемой ноды.

TFLOPS не сравниваются напрямую между разными типами точности и sparsity. Tier — класс продукта, не вычисленный уровень доступа пользователя; условия доступа ещё не определены. Остатки не заданы заказчиком, поэтому в seed `supply_known=false`. 42 из 200 означает 21%, а не 78%.

## Ассеты: исходные промпты

Общее: square 1:1, full device with generous margins, dark background #07080E, no text, no logo, consistent cyberpunk catalogue lighting.

1. RTX4090: futuristic high-tech GPU module, glowing neon cyan lines, internal liquid cooling pipes, dark metallic chassis, isometric 3D render, sci-fi hardware detail.
2. A100: sci-fi server rack blade module, glowing neon blue tensor cores, sleek matte black finish, hologram data streams, volumetric lighting.
3. H100: massive enterprise AI supercomputer node, glowing magenta and purple light strips, heavy cybernetic aesthetic, isometric 3D icon, ultra-realistic.
4. Quantum: futuristic quantum computing core inside a glass sphere, violet and deep crimson energy beams, sci-fi hardware, hyper-detailed 3D render.

## Обновление

Запустить два поставляемых скрипта в обычном Termux. Первый применяет встроенный patch к `joxydev/gpunode`, создаёт локальную резервную ветку и пушит main без force. Повторный запуск распознаёт применённое обновление. При конфликтующих изменениях останавливается до записи файлов.

Второй получает точный коммит main с GitHub и собирает его на VPS. `ops/market-deploy.sh` рассчитан на уже работающий gpunode из предыдущего этапа. Делает pg_dump, сохраняет конфигурацию, применяет добавочную миграцию, переключает release и проверяет HTTPS, API, JS/CSS и изображения. При ошибке переключает обратно приложение и unit; схема БД автоматически не откатывается. Старые релизы и копии не удаляются. HTTPS, сертификат, секреты и кнопка существующего бота сохраняются.

Проверки: `npm run db:generate`, `npm test`, `npm run build`. Тест миграции и ACID-ядра использует изолированный PGlite, проверяет сохранение данных, точные суммы, лимиты, повтор запросов и rollback после ошибки ledger. PGlite не заменяет нагрузочные проверки PostgreSQL с параллельными соединениями; это обязательный этап перед открытием оплат.

Перед передачей выполнены production build, 9 тестов и проверки Chromium на 320/390/768/1280 px: категории, сортировка, детали, Escape, заявка с требованием входа, Quantum, Sold Out, 21% остатка и повтор загрузки после 503. Для браузерных проверок API каталога подставлялся из изолированной PGlite через тот же сериализатор `present`; это не проверка реального Telegram WebView или VPS. Размеры всех 36 изображений проверены. GitHub Checks после push отдельно запускает HTTP-интеграцию Nest/Prisma на PostgreSQL 16; скрипты требуют успешного результата перед деплоем. Сам VPS из среды разработки не изменялся.
