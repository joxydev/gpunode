-- The multi-tariff release permits one unfinished contract per user and tariff.
-- Earlier catalogue rows still carry the original limits 5 / 3 / 2.
-- Change only this configuration: never rewrite inventory or financial history.
UPDATE gpu_catalog
SET max_per_user = 1
WHERE id IN ('NODE_4090', 'NODE_A100', 'NODE_H100')
  AND max_per_user <> 1;
