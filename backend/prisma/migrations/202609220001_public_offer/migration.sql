-- Public offer № 88/2026-AI. Additive and safe for the currently deployed schema.
BEGIN;

ALTER TABLE gpu_catalog
  ADD COLUMN compound_boost_percent DECIMAL(5,2);

UPDATE gpu_catalog SET
  name='Node Alpha',
  category='CONSUMER',
  tier_level=1,
  price_usdt=50,
  daily_yield_percent=1.50,
  compound_boost_percent=1.80,
  contract_days=30,
  workload='Выделенный слот в коммерческом DePIN-кластере; оборудование назначает Оператор',
  is_active=TRUE,
  is_experimental=FALSE
WHERE id='NODE_4090';

UPDATE gpu_catalog SET
  name='Cluster Beta',
  category='ENTERPRISE',
  tier_level=2,
  price_usdt=300,
  daily_yield_percent=2.50,
  compound_boost_percent=3.00,
  contract_days=60,
  workload='Кластерный слот для B2B-задач машинного обучения; оборудование назначает Оператор',
  is_active=TRUE,
  is_experimental=FALSE
WHERE id='NODE_A100';

UPDATE gpu_catalog SET
  name='Enterprise POD',
  category='ENTERPRISE',
  tier_level=3,
  price_usdt=1200,
  daily_yield_percent=3.50,
  compound_boost_percent=4.20,
  contract_days=90,
  workload='Высокопроизводительный POD для B2B-нагрузки; оборудование назначает Оператор',
  is_active=TRUE,
  is_experimental=FALSE
WHERE id='NODE_H100';

UPDATE gpu_catalog SET
  name='Quantum Array',
  category='QUANTUM',
  tier_level=4,
  price_usdt=5000,
  daily_yield_percent=0,
  compound_boost_percent=NULL,
  contract_days=180,
  workload='Экспериментальная категория; параметры доходности в разработке, анонс Q4 2026',
  is_active=TRUE,
  is_experimental=TRUE
WHERE id='NODE_QBIT';

ALTER TABLE "User"
  ADD COLUMN "selectedTariffId" VARCHAR(64),
  ADD COLUMN "selectedTariffAt" TIMESTAMP(3);

ALTER TABLE "User"
  ADD CONSTRAINT "User_selectedTariffId_fkey"
  FOREIGN KEY ("selectedTariffId") REFERENCES gpu_catalog(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_selectedTariffId_idx" ON "User"("selectedTariffId");

CREATE TABLE offer_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  version VARCHAR(64) NOT NULL,
  document_sha256 VARCHAR(64) NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  client_hash VARCHAR(64) NOT NULL CHECK (client_hash ~ '^[0-9a-f]{64}$'),
  accepted_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT offer_acceptances_user_version_key UNIQUE(user_id,version)
);

CREATE INDEX offer_acceptances_accepted_at_idx ON offer_acceptances(accepted_at);
COMMIT;
