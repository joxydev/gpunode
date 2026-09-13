-- Additive migration. Existing Telegram TEXT identities and immutable LedgerEntry stay intact.
BEGIN;
CREATE TABLE gpu_catalog (
 id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL,
 category TEXT NOT NULL CHECK (category IN ('CONSUMER','ENTERPRISE','QUANTUM')),
 tier_level INT NOT NULL CHECK (tier_level BETWEEN 1 AND 4),
 chip TEXT NOT NULL, precision_label TEXT NOT NULL, workload TEXT NOT NULL,
 price_usdt DECIMAL(18,2) NOT NULL CHECK (price_usdt > 0),
 daily_yield_percent DECIMAL(5,2) NOT NULL CHECK (daily_yield_percent BETWEEN 0 AND 100),
 tflops_power INT NOT NULL CHECK (tflops_power > 0),
 total_supply INT NOT NULL DEFAULT 0 CHECK (total_supply >= 0),
 available_supply INT NOT NULL DEFAULT 0 CHECK (available_supply BETWEEN 0 AND total_supply),
 supply_known BOOLEAN NOT NULL DEFAULT FALSE,
 contract_days INT NOT NULL CHECK (contract_days BETWEEN 1 AND 3650),
 max_per_user INT NOT NULL CHECK (max_per_user > 0),
 image_url VARCHAR(512) NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, is_experimental BOOLEAN NOT NULL DEFAULT FALSE,
 contract_reference TEXT,
 CONSTRAINT unknown_pool_empty CHECK (supply_known OR (total_supply = 0 AND available_supply = 0))
);
CREATE TABLE user_leases (
 id UUID PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 node_id VARCHAR(64) NOT NULL REFERENCES gpu_catalog(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 purchase_price DECIMAL(18,2) NOT NULL CHECK (purchase_price > 0),
 daily_yield_usdt DECIMAL(18,4) NOT NULL CHECK (daily_yield_usdt >= 0),
 contract_reference TEXT NOT NULL CHECK (length(contract_reference) > 0),
 idempotency_key UUID NOT NULL,
 status TEXT NOT NULL DEFAULT 'PROVISIONING' CHECK (status IN ('PROVISIONING','ACTIVE','EXPIRED','OVERCLOCKED','CANCELLED')),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TIMESTAMPTZ(3) NOT NULL,
 last_yield_calc TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX user_leases_user_id_idempotency_key_key ON user_leases(user_id,idempotency_key);
CREATE INDEX user_leases_user_id_node_id_status_idx ON user_leases(user_id,node_id,status);
-- Prices/rates below are planning parameters from the product brief, NOT earned revenue.
-- No inventory count, real workload, or signed contract was supplied. Never seed invented stock.
INSERT INTO gpu_catalog (id,name,category,tier_level,chip,precision_label,workload,price_usdt,daily_yield_percent,tflops_power,contract_days,max_per_user,image_url,is_experimental) VALUES
 ('NODE_4090','RTX 4090 Neural Node','CONSUMER',1,'24 GB GDDR6X','FP32 · 82,6 ≈ 83 TFLOPS','Fine-tuning · inference · компьютерное зрение',50,3.5,83,90,5,'/assets/market/4090',FALSE),
 ('NODE_A100','A100 Tensor Cluster','ENTERPRISE',2,'80 GB HBM2e','BF16 / FP16 Tensor · без sparsity','Обучение LLM · большие датасеты',300,5,312,120,3,'/assets/market/a100',FALSE),
 ('NODE_H100','H100 Enterprise POD','ENTERPRISE',3,'80 GB HBM3','BF16 Tensor · sparsity · SXM · 1 979 ≈ 2 000','LLM training · пакетный инференс',1200,6.5,2000,180,2,'/assets/market/h100',FALSE),
 ('NODE_QBIT','Quantum AI Server','QUANTUM',4,'Photonic Array','Концептуальная величина · не подтверждена измерениями','Экспериментальное направление R&D',5000,8.5,50000,365,1,'/assets/market/qbit',TRUE);
COMMIT;
