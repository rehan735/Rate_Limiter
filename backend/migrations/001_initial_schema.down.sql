-- 001_initial_schema.down.sql
-- Rollback for initial schema migration

DROP TRIGGER IF EXISTS update_plans_updated_at       ON subscription_plans;
DROP TRIGGER IF EXISTS update_gateways_updated_at    ON gateway_instances;
DROP TRIGGER IF EXISTS update_api_keys_updated_at    ON api_keys;
DROP TRIGGER IF EXISTS update_routes_updated_at      ON routes;
DROP TRIGGER IF EXISTS update_backends_updated_at    ON backend_services;
DROP TRIGGER IF EXISTS update_policies_updated_at    ON policies;
DROP TRIGGER IF EXISTS update_users_updated_at       ON users;
DROP TRIGGER IF EXISTS update_tenants_updated_at     ON tenants;

DROP FUNCTION IF EXISTS update_updated_at_column();

DROP TABLE IF EXISTS config_versions;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS gateway_instances;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS backend_services;
DROP TABLE IF EXISTS policies;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS tenants;
DROP TABLE IF EXISTS subscription_plans;

DROP EXTENSION IF EXISTS "pg_trgm";
DROP EXTENSION IF EXISTS "uuid-ossp";
