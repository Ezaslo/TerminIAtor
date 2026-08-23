ALTER TABLE users
ADD COLUMN monthly_quota_hours INTEGER;

ALTER TABLE users
ADD CONSTRAINT users_monthly_quota_hours_check
CHECK (
  monthly_quota_hours IS NULL
  OR monthly_quota_hours BETWEEN 0 AND 744
);

ALTER TABLE groups
ADD COLUMN monthly_quota_hours INTEGER;

ALTER TABLE groups
ADD CONSTRAINT groups_monthly_quota_hours_check
CHECK (
  monthly_quota_hours IS NULL
  OR monthly_quota_hours BETWEEN 0 AND 744
);