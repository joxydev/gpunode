DROP INDEX IF EXISTS user_wallets_address_key;
CREATE INDEX user_wallets_network_address_idx ON user_wallets(network,address);
CREATE INDEX deposits_sender_status_idx ON deposits(sender_address,status);
CREATE TABLE wallet_binding_history(id bigserial PRIMARY KEY,user_id text NOT NULL REFERENCES "User"(id),network text NOT NULL,address text NOT NULL,verified boolean NOT NULL,changed_at timestamptz NOT NULL DEFAULT now(),action text NOT NULL);
CREATE INDEX wallet_binding_history_address_idx ON wallet_binding_history(network,address,user_id);
CREATE FUNCTION immutable_network_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_NETWORK_RECORD'; END $$;
CREATE TRIGGER immutable_wallet_history BEFORE UPDATE OR DELETE ON wallet_binding_history FOR EACH ROW EXECUTE FUNCTION immutable_network_record();
INSERT INTO wallet_binding_history(user_id,network,address,verified,changed_at,action) SELECT user_id,network,address,verified,created_at,'IMPORTED' FROM user_wallets;
CREATE FUNCTION record_wallet_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN INSERT INTO wallet_binding_history(user_id,network,address,verified,action) VALUES(OLD.user_id,OLD.network,OLD.address,OLD.verified,'DISCONNECTED'); RETURN OLD; END IF;
 IF TG_OP='INSERT' OR NEW.address IS DISTINCT FROM OLD.address OR NEW.verified IS DISTINCT FROM OLD.verified THEN
  INSERT INTO wallet_binding_history(user_id,network,address,verified,action) VALUES(NEW.user_id,NEW.network,NEW.address,NEW.verified,'CONNECTED'); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER record_wallet_binding AFTER INSERT OR UPDATE OR DELETE ON user_wallets FOR EACH ROW EXECUTE FUNCTION record_wallet_binding();
