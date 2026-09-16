BEGIN;
-- Retain historical profiles; all new requests are managed by the service.
ALTER TABLE "RentalRequest" DROP CONSTRAINT "request_profile";
ALTER TABLE "RentalRequest" ADD CONSTRAINT "request_profile"
 CHECK ("profile" IN ('ECO','BALANCED','PERFORMANCE','MANAGED'));
COMMIT;
