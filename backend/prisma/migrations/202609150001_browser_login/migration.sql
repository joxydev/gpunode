BEGIN;
CREATE TABLE browser_logins (
 id UUID PRIMARY KEY,
 secret_hash VARCHAR(64) NOT NULL,
 ip_hash VARCHAR(64) NOT NULL,
 telegram_id TEXT,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','DENIED')),
 expires_at TIMESTAMPTZ(3) NOT NULL,
 consumed_at TIMESTAMPTZ(3)
);
CREATE INDEX browser_logins_ip_hash_idx ON browser_logins(ip_hash);
CREATE INDEX browser_logins_expires_at_idx ON browser_logins(expires_at);
COMMIT;
