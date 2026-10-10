-- Fail before any index/guard change. Never repair or cancel a financial row.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM user_leases WHERE status IN ('PROVISIONING','ACTIVE','OVERCLOCKED','EXPIRED') GROUP BY user_id,node_id HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM "RentalRequest" WHERE "isTestOrder"=false AND lease_id IS NULL AND status IN ('REQUESTED','REVIEWED') GROUP BY "userId","nodeId" HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM "RentalRequest" r JOIN user_leases l ON l.user_id=r."userId" AND l.node_id=r."nodeId" WHERE r."isTestOrder"=false AND r.lease_id IS NULL AND r.status IN ('REQUESTED','REVIEWED') AND l.status IN ('PROVISIONING','ACTIVE','OVERCLOCKED','EXPIRED')) THEN
 RAISE EXCEPTION 'MULTI_TARIFF_CONFLICT: run ops/network-preflight.mjs; financial rows must be reconciled separately'; END IF;
END $$;
CREATE UNIQUE INDEX one_unfinished_tariff ON user_leases(user_id,node_id) WHERE status IN ('PROVISIONING','ACTIVE','OVERCLOCKED','EXPIRED');
CREATE UNIQUE INDEX one_legacy_tariff ON "RentalRequest"("userId","nodeId") WHERE "isTestOrder"=false AND lease_id IS NULL AND status IN ('REQUESTED','REVIEWED');
CREATE FUNCTION guard_tariff_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u text; n text;
BEGIN
 IF TG_TABLE_NAME='user_leases' THEN
  IF NEW.status NOT IN ('PROVISIONING','ACTIVE','OVERCLOCKED','EXPIRED') THEN RETURN NEW; END IF;
  u=NEW.user_id; n=NEW.node_id;
 ELSE
  IF NEW."isTestOrder" OR NEW.lease_id IS NOT NULL OR NEW.status NOT IN ('REQUESTED','REVIEWED') THEN RETURN NEW; END IF;
  u=NEW."userId"; n=NEW."nodeId";
 END IF;
 PERFORM id FROM "User" WHERE id=u FOR UPDATE;
 IF TG_TABLE_NAME='user_leases' AND EXISTS(SELECT 1 FROM "RentalRequest" WHERE "userId"=u AND "nodeId"=n AND "isTestOrder"=false AND lease_id IS NULL AND status IN ('REQUESTED','REVIEWED'))
 OR TG_TABLE_NAME='RentalRequest' AND EXISTS(SELECT 1 FROM user_leases WHERE user_id=u AND node_id=n AND status IN ('PROVISIONING','ACTIVE','OVERCLOCKED','EXPIRED')) THEN
 RAISE EXCEPTION 'TARIFF_RESERVED' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_lease_reservation BEFORE INSERT OR UPDATE ON user_leases FOR EACH ROW EXECUTE FUNCTION guard_tariff_reservation();
CREATE TRIGGER guard_legacy_reservation BEFORE INSERT OR UPDATE ON "RentalRequest" FOR EACH ROW EXECUTE FUNCTION guard_tariff_reservation();
