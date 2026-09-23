ALTER TABLE "User" ADD COLUMN "preferredLanguage" VARCHAR(2);
ALTER TABLE "User" ADD CONSTRAINT "user_preferred_language_check" CHECK ("preferredLanguage" IS NULL OR "preferredLanguage" IN ('ru','en','ro'));
