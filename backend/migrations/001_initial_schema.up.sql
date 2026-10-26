-- 001_initial_schema.up.sql
-- Initial schema for the Distributed Rate Limiter & API Gateway
-- Author: System
-- Rollback: 001_initial_schema.down.sql

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- Subscription Plans
-- ============================================================
CREATE TABLE subscription_plans (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                 VARCHAR(255) NOT NULL UNIQUE,
    requests_per_minute  INT NOT NULL DEFAULT 1000,
    requests_per_day     INT NOT NULL DEFAULT 100000,
    burst_capacity       INT NOT NULL DEFAULT 200,
    max_api_keys         INT NOT NULL DEFAULT 10,
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Tenants
-- ============================================================
CREATE TABLE tenants (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(255) NOT NULL UNIQUE,
    plan_id     UUID REFERENCES subscription_plans(id) ON DELETE SET NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_tenants_slug       ON tenants(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_tenants_is_active  ON tenants(is_active) WHERE deleted_at IS NULL;

-- ============================================================
-- Users
-- ============================================================
CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email          VARCHAR(320) NOT NULL UNIQUE,
    password_hash  VARCHAR(1024) NOT NULL,
    role           VARCHAR(50) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'operator', 'developer', 'viewer')),
    tenant_id      UUID REFERENCES tenants(id) ON DELETE SET NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ
);

CREATE INDEX idx_users_email       ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_tenant_id   ON users(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role        ON users(role);

-- ============================================================
-- Refresh Tokens
-- ============================================================
CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(512) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- ============================================================
-- Rate-Limit Policies
-- ============================================================
CREATE TABLE policies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL UNIQUE,
    description     TEXT NOT NULL DEFAULT '',
    algorithm       VARCHAR(50) NOT NULL DEFAULT 'token_bucket'
                    CHECK (algorithm IN ('token_bucket', 'fixed_window', 'sliding_window', 'sliding_window_log')),
    limit_count     INT NOT NULL CHECK (limit_count > 0),
    window_seconds  INT NOT NULL CHECK (window_seconds > 0),
    burst_capacity  INT NOT NULL DEFAULT 0 CHECK (burst_capacity >= 0),
    refill_rate     DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (refill_rate >= 0),
    request_cost    INT NOT NULL DEFAULT 1 CHECK (request_cost >= 1),
    key_pattern     VARCHAR(255) NOT NULL DEFAULT '{ip}',
    failure_mode    VARCHAR(50) NOT NULL DEFAULT 'fail_open'
                    CHECK (failure_mode IN ('fail_open', 'fail_closed', 'local_fallback')),
    dimensions      TEXT[] NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_policies_is_active ON policies(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_policies_algorithm ON policies(algorithm);

-- ============================================================
-- Backend Services
-- ============================================================
CREATE TABLE backend_services (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                  VARCHAR(255) NOT NULL UNIQUE,
    description           TEXT NOT NULL DEFAULT '',
    targets               TEXT[] NOT NULL,
    load_balancing_policy VARCHAR(50) NOT NULL DEFAULT 'round_robin'
                          CHECK (load_balancing_policy IN ('round_robin', 'weighted', 'random')),
    health_check_path     VARCHAR(1024) NOT NULL DEFAULT '/health',
    health_check_interval BIGINT NOT NULL DEFAULT 10000000000,  -- 10s in nanoseconds
    connect_timeout       BIGINT NOT NULL DEFAULT 5000000000,   -- 5s
    response_timeout      BIGINT NOT NULL DEFAULT 30000000000,  -- 30s
    max_retries           INT NOT NULL DEFAULT 2 CHECK (max_retries >= 0),
    retry_on              TEXT[] NOT NULL DEFAULT '{"connection_error","timeout"}',
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at            TIMESTAMPTZ
);

CREATE INDEX idx_backends_is_active ON backend_services(is_active) WHERE deleted_at IS NULL;

-- ============================================================
-- Routes
-- ============================================================
CREATE TABLE routes (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             VARCHAR(255) NOT NULL UNIQUE,
    description      TEXT NOT NULL DEFAULT '',
    path_prefix      VARCHAR(1024) NOT NULL DEFAULT '',
    exact_path       VARCHAR(1024) NOT NULL DEFAULT '',
    methods          TEXT[] NOT NULL DEFAULT '{"GET","POST","PUT","PATCH","DELETE"}',
    backend_id       UUID NOT NULL REFERENCES backend_services(id) ON DELETE RESTRICT,
    strip_prefix     BOOLEAN NOT NULL DEFAULT FALSE,
    policy_id        UUID REFERENCES policies(id) ON DELETE SET NULL,
    request_cost     INT NOT NULL DEFAULT 1 CHECK (request_cost >= 1),
    requires_auth    BOOLEAN NOT NULL DEFAULT FALSE,
    allowed_roles    TEXT[] NOT NULL DEFAULT '{}',
    request_headers  JSONB NOT NULL DEFAULT '{}',
    response_headers JSONB NOT NULL DEFAULT '{}',
    max_body_size    BIGINT NOT NULL DEFAULT 10485760,
    timeout          BIGINT NOT NULL DEFAULT 30000000000,  -- 30s
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    priority         INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ,
    CONSTRAINT chk_route_path CHECK (path_prefix != '' OR exact_path != '')
);

CREATE INDEX idx_routes_is_active   ON routes(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_routes_path_prefix ON routes(path_prefix) WHERE deleted_at IS NULL;
CREATE INDEX idx_routes_priority    ON routes(priority DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_routes_backend_id  ON routes(backend_id);

-- ============================================================
-- API Keys
-- ============================================================
CREATE TABLE api_keys (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         VARCHAR(255) NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    key_hash     VARCHAR(512) NOT NULL UNIQUE,
    key_prefix   VARCHAR(20) NOT NULL,
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    policy_id    UUID REFERENCES policies(id) ON DELETE SET NULL,
    expires_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_key_hash   ON api_keys(key_hash);
CREATE INDEX idx_api_keys_tenant_id  ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_key_prefix ON api_keys(key_prefix);

-- ============================================================
-- Gateway Instances
-- ============================================================
CREATE TABLE gateway_instances (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hostname          VARCHAR(255) NOT NULL,
    ip_address        INET NOT NULL,
    port              INT NOT NULL,
    version           VARCHAR(50) NOT NULL,
    config_version    BIGINT NOT NULL DEFAULT 0,
    status            VARCHAR(50) NOT NULL DEFAULT 'starting',
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gateways_status ON gateway_instances(status);

-- ============================================================
-- Audit Logs
-- ============================================================
CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
    action      VARCHAR(100) NOT NULL,
    resource    VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255) NOT NULL DEFAULT '',
    ip_address  INET,
    user_agent  TEXT NOT NULL DEFAULT '',
    changes     JSONB,
    status      VARCHAR(50) NOT NULL DEFAULT 'success',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id    ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_tenant_id  ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_action     ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource   ON audit_logs(resource, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================
-- Configuration Versions
-- ============================================================
CREATE TABLE config_versions (
    id           BIGSERIAL PRIMARY KEY,
    entity_type  VARCHAR(100) NOT NULL,
    entity_id    UUID NOT NULL,
    version      INT NOT NULL DEFAULT 1,
    config       JSONB NOT NULL,
    changed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, entity_id, version)
);

CREATE INDEX idx_config_versions_entity ON config_versions(entity_type, entity_id);

-- ============================================================
-- Trigger: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tenants_updated_at        BEFORE UPDATE ON tenants           FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at          BEFORE UPDATE ON users             FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_policies_updated_at       BEFORE UPDATE ON policies          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_backends_updated_at       BEFORE UPDATE ON backend_services  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_routes_updated_at         BEFORE UPDATE ON routes            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_api_keys_updated_at       BEFORE UPDATE ON api_keys          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gateways_updated_at       BEFORE UPDATE ON gateway_instances FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_plans_updated_at          BEFORE UPDATE ON subscription_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Seed: Default subscription plans
-- ============================================================
INSERT INTO subscription_plans (name, requests_per_minute, requests_per_day, burst_capacity, max_api_keys)
VALUES
    ('free',       100,    10000,   20,  2),
    ('starter',    1000,   100000,  200, 10),
    ('pro',        10000,  1000000, 500, 50),
    ('enterprise', 100000, 10000000, 2000, 500);
