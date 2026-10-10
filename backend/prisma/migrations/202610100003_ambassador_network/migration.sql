-- Immutable tree, source outbox and monetary receipts. All financial history stays intact.
DO $$ BEGIN
 IF EXISTS(WITH RECURSIVE t AS (SELECT id,"referrerId" parent,ARRAY[id] seen,false cycle FROM "User" UNION ALL SELECT t.id,u."referrerId",t.seen||u.id,u.id=ANY(t.seen) FROM t JOIN "User" u ON u.id=t.parent WHERE NOT t.cycle) SELECT 1 FROM t WHERE cycle)
 OR EXISTS(SELECT 1 FROM "User" u LEFT JOIN "User" p ON p.id=u."referrerId" WHERE u."referrerId" IS NOT NULL AND p.id IS NULL) THEN RAISE EXCEPTION 'REFERRAL_TREE_CONFLICT: review the preflight report'; END IF;
END $$;
CREATE TABLE network_paths(ancestor text NOT NULL REFERENCES "User"(id),descendant text NOT NULL REFERENCES "User"(id),depth integer NOT NULL CHECK(depth>0),joined_at timestamptz NOT NULL,PRIMARY KEY(ancestor,descendant),CHECK(ancestor<>descendant));
CREATE INDEX network_paths_descendant_idx ON network_paths(descendant,depth);
INSERT INTO network_paths WITH RECURSIVE t AS(
 SELECT "referrerId" ancestor,id descendant,1 depth,"createdAt" AT TIME ZONE 'UTC' joined_at FROM "User" WHERE "referrerId" IS NOT NULL
 UNION ALL SELECT p."referrerId",t.descendant,t.depth+1,t.joined_at FROM t JOIN "User" p ON p.id=t.ancestor WHERE p."referrerId" IS NOT NULL
) SELECT * FROM t;
CREATE FUNCTION guard_network_referrer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(2026101003);
 IF TG_OP='UPDATE' AND OLD."referrerId" IS DISTINCT FROM NEW."referrerId" THEN RAISE EXCEPTION 'REFERRER_IMMUTABLE'; END IF;
 IF NEW."referrerId"=NEW.id OR EXISTS(SELECT 1 FROM network_paths WHERE ancestor=NEW.id AND descendant=NEW."referrerId") THEN RAISE EXCEPTION 'REFERRAL_CYCLE'; END IF;
 RETURN NEW; END $$;
CREATE FUNCTION add_network_path() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."referrerId" IS NOT NULL THEN
  INSERT INTO network_paths VALUES(NEW."referrerId",NEW.id,1,NEW."createdAt" AT TIME ZONE 'UTC');
  INSERT INTO network_paths SELECT ancestor,NEW.id,depth+1,NEW."createdAt" AT TIME ZONE 'UTC' FROM network_paths WHERE descendant=NEW."referrerId";
 END IF; RETURN NEW; END $$;
CREATE TRIGGER guard_network_referrer BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION guard_network_referrer();
CREATE TRIGGER add_network_path AFTER INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION add_network_path();
CREATE TRIGGER immutable_network_paths BEFORE UPDATE OR DELETE ON network_paths FOR EACH ROW EXECUTE FUNCTION immutable_network_record();
CREATE TABLE network_policy(version text PRIMARY KEY,decisions jsonb NOT NULL,actor_id text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER immutable_network_policy BEFORE UPDATE OR DELETE ON network_policy FOR EACH ROW EXECUTE FUNCTION immutable_network_record();
CREATE TABLE network_source(id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN('ACT','DAILY','FEE')),user_id text NOT NULL REFERENCES "User"(id),lease_id uuid NOT NULL REFERENCES user_leases(id),amount_micros bigint NOT NULL CHECK(amount_micros>=0),occurred_at timestamptz NOT NULL,scope text NOT NULL,snapshot jsonb NOT NULL,received_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX network_source_time_idx ON network_source(occurred_at,id);
CREATE INDEX network_source_user_kind_idx ON network_source(user_id,kind,occurred_at);
CREATE TRIGGER immutable_network_source BEFORE UPDATE OR DELETE ON network_source FOR EACH ROW EXECUTE FUNCTION immutable_network_record();
CREATE TABLE network_source_processing(source_id text PRIMARY KEY REFERENCES network_source(id),policy_version text NOT NULL,status text NOT NULL,last_error text,processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE network_reward(id text PRIMARY KEY,recipient text NOT NULL REFERENCES "User"(id),source_id text,kind text NOT NULL,line integer NOT NULL DEFAULT 0,scope text NOT NULL,policy_version text NOT NULL,base_micros bigint NOT NULL,rate_bps integer NOT NULL,amount_micros bigint NOT NULL,remainder_before integer NOT NULL DEFAULT 0,remainder_after integer NOT NULL DEFAULT 0,occurred_at timestamptz NOT NULL,status text NOT NULL,reason text,ledger_id text UNIQUE REFERENCES "LedgerEntry"(id),details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(recipient,source_id,kind,line,scope));
CREATE INDEX network_reward_recipient_idx ON network_reward(recipient,occurred_at,id);
CREATE INDEX network_reward_status_idx ON network_reward(status,created_at);
CREATE TRIGGER immutable_network_reward BEFORE UPDATE OR DELETE ON network_reward FOR EACH ROW EXECUTE FUNCTION immutable_network_record();
CREATE TABLE network_carry(recipient text NOT NULL,kind text NOT NULL,line integer NOT NULL,scope text NOT NULL,remainder integer NOT NULL CHECK(remainder>=0 AND remainder<10000),PRIMARY KEY(recipient,kind,line,scope));
CREATE TABLE network_rank(user_id text NOT NULL REFERENCES "User"(id),rank integer NOT NULL CHECK(rank BETWEEN 1 AND 3),achieved_at timestamptz NOT NULL,source_id text NOT NULL,PRIMARY KEY(user_id,rank));
CREATE TRIGGER immutable_network_rank BEFORE UPDATE OR DELETE ON network_rank FOR EACH ROW EXECUTE FUNCTION immutable_network_record();
CREATE TABLE network_period(id text PRIMARY KEY,kind text NOT NULL,start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,snapshot_at timestamptz NOT NULL,deadline timestamptz,status text NOT NULL,policy_version text,plan jsonb,frozen_at timestamptz,paid_micros bigint NOT NULL DEFAULT 0,undistributed_micros bigint NOT NULL DEFAULT 0,last_error text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE network_period_resolution(period_id text PRIMARY KEY REFERENCES network_period(id),policy_version text NOT NULL REFERENCES network_policy(version),plan jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER immutable_network_period_resolution BEFORE UPDATE OR DELETE ON network_period_resolution FOR EACH ROW EXECUTE FUNCTION immutable_network_record();
CREATE INDEX network_period_status_idx ON network_period(status,end_at);
CREATE TABLE network_backfill(report_hash text PRIMARY KEY,report jsonb NOT NULL,actor_id text NOT NULL,reason text NOT NULL,approved_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER immutable_network_backfill BEFORE UPDATE OR DELETE ON network_backfill FOR EACH ROW EXECUTE FUNCTION immutable_network_record();
CREATE TABLE network_review(id bigserial PRIMARY KEY,actor_id text NOT NULL,user_id text NOT NULL,decision text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER immutable_network_review BEFORE UPDATE OR DELETE ON network_review FOR EACH ROW EXECUTE FUNCTION immutable_network_record();
CREATE FUNCTION protect_network_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.kind LIKE 'AMB_%' OR EXISTS(SELECT 1 FROM network_reward WHERE ledger_id=OLD.id) THEN RAISE EXCEPTION 'IMMUTABLE_NETWORK_LEDGER'; END IF; RETURN OLD; END $$;
CREATE TRIGGER protect_network_ledger BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION protect_network_ledger();
CREATE FUNCTION emit_network_activation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.activated_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.activated_at IS NULL) AND NEW.principal_micros IS NOT NULL THEN
  INSERT INTO network_source VALUES('ACT:'||NEW.id,'ACT',NEW.user_id,NEW.id,NEW.principal_micros,NEW.activated_at,'LIVE',jsonb_build_object('nodeId',NEW.node_id,'offerVersion',NEW.offer_version,'documentSha256',NEW.offer_document_sha256),now()) ON CONFLICT DO NOTHING;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER emit_network_activation AFTER INSERT OR UPDATE ON user_leases FOR EACH ROW EXECUTE FUNCTION emit_network_activation();
CREATE FUNCTION emit_network_daily() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE l user_leases; BEGIN
 SELECT * INTO l FROM user_leases WHERE id=NEW.lease_id;
 IF l.activated_at IS NOT NULL THEN INSERT INTO network_source VALUES('DAILY:'||NEW.id,'DAILY',l.user_id,l.id,NEW.yield_micros,l.activated_at+NEW.day_index*interval '24 hours','LIVE',jsonb_build_object('accrualId',NEW.id,'dayIndex',NEW.day_index,'mode',NEW.mode),now()) ON CONFLICT DO NOTHING; END IF; RETURN NEW; END $$;
CREATE TRIGGER emit_network_daily AFTER INSERT ON lease_accruals FOR EACH ROW EXECUTE FUNCTION emit_network_daily();
CREATE FUNCTION emit_network_fee() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE l uuid; BEGIN
 IF NEW.kind='EARLY_UNBONDING_FEE' AND NEW."amountMicros"<=0 AND NEW."sourceId" ~ '^lease:[0-9a-f-]{36}:unbond-fee$' THEN
  l=split_part(NEW."sourceId",':',2)::uuid;
  INSERT INTO network_source VALUES('FEE:'||NEW.id,'FEE',NEW."userId",l,-NEW."amountMicros",NEW."createdAt" AT TIME ZONE 'UTC','LIVE',jsonb_build_object('ledgerId',NEW.id),now()) ON CONFLICT DO NOTHING;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER emit_network_fee AFTER INSERT ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION emit_network_fee();
INSERT INTO network_source SELECT 'ACT:'||id,'ACT',user_id,id,principal_micros,activated_at,'HISTORY',jsonb_build_object('nodeId',node_id,'offerVersion',offer_version,'documentSha256',offer_document_sha256),now() FROM user_leases WHERE activated_at IS NOT NULL AND principal_micros IS NOT NULL;
INSERT INTO network_source SELECT 'DAILY:'||a.id,'DAILY',l.user_id,l.id,a.yield_micros,l.activated_at+a.day_index*interval '24 hours','HISTORY',jsonb_build_object('accrualId',a.id,'dayIndex',a.day_index,'mode',a.mode),now() FROM lease_accruals a JOIN user_leases l ON l.id=a.lease_id WHERE l.activated_at IS NOT NULL;
INSERT INTO network_source SELECT 'FEE:'||e.id,'FEE',e."userId",l.id,-e."amountMicros",e."createdAt" AT TIME ZONE 'UTC','HISTORY',jsonb_build_object('ledgerId',e.id),now() FROM "LedgerEntry" e JOIN user_leases l ON e."sourceId"='lease:'||l.id||':unbond-fee' WHERE e.kind='EARLY_UNBONDING_FEE' AND e."amountMicros"<=0;

CREATE FUNCTION network_frozen_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.plan IS NOT NULL AND (NEW.plan IS DISTINCT FROM OLD.plan OR NEW.policy_version IS DISTINCT FROM OLD.policy_version OR NEW.start_at IS DISTINCT FROM OLD.start_at OR NEW.end_at IS DISTINCT FROM OLD.end_at) THEN
 RAISE EXCEPTION 'FROZEN_NETWORK_PERIOD_IMMUTABLE'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER network_frozen_period BEFORE UPDATE ON network_period FOR EACH ROW EXECUTE FUNCTION network_frozen_period_guard();
