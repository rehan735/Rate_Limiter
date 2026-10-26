package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/rate-limiter/gateway/internal/models"
)

// UserStore handles user persistence.
type UserStore struct {
	db *DB
}

func NewUserStore(db *DB) *UserStore {
	return &UserStore{db: db}
}

func (s *UserStore) Create(ctx context.Context, user *models.User) error {
	query := `
		INSERT INTO users (id, email, password_hash, role, tenant_id, is_active)
		VALUES (:id, :email, :password_hash, :role, :tenant_id, :is_active)
	`
	if user.ID == uuid.Nil {
		user.ID = uuid.New()
	}
	_, err := s.db.NamedExecContext(ctx, query, user)
	return err
}

func (s *UserStore) GetByEmail(ctx context.Context, email string) (*models.User, error) {
	var user models.User
	err := s.db.GetContext(ctx, &user,
		`SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL`, email)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return &user, err
}

func (s *UserStore) GetByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	var user models.User
	err := s.db.GetContext(ctx, &user,
		`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, id)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return &user, err
}

func (s *UserStore) CreateRaw(ctx context.Context, email, passwordHash, role string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO users (id, email, password_hash, role, is_active) VALUES (uuid_generate_v4(), $1, $2, $3, true)`,
		email, passwordHash, role)
	return err
}

func (s *UserStore) UpdateLastLogin(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET last_login_at = $1, updated_at = NOW() WHERE id = $2`, now, id)
	return err
}

func (s *UserStore) List(ctx context.Context, page, pageSize int) ([]*models.User, int64, error) {
	offset := (page - 1) * pageSize
	var users []*models.User
	err := s.db.SelectContext(ctx, &users,
		`SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
		pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	var total int64
	err = s.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM users WHERE deleted_at IS NULL`)
	return users, total, err
}

// PolicyStore handles rate-limit policy persistence.
type PolicyStore struct {
	db *DB
}

func NewPolicyStore(db *DB) *PolicyStore {
	return &PolicyStore{db: db}
}

func (s *PolicyStore) Create(ctx context.Context, p *models.Policy) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	query := `
		INSERT INTO policies (
			id, name, description, algorithm, limit_count, window_seconds,
			burst_capacity, refill_rate, request_cost, key_pattern, failure_mode,
			dimensions, is_active
		) VALUES (
			:id, :name, :description, :algorithm, :limit_count, :window_seconds,
			:burst_capacity, :refill_rate, :request_cost, :key_pattern, :failure_mode,
			:dimensions, :is_active
		)
	`
	_, err := s.db.NamedExecContext(ctx, query, p)
	return err
}

func (s *PolicyStore) GetByID(ctx context.Context, id uuid.UUID) (*models.Policy, error) {
	var p models.Policy
	err := s.db.GetContext(ctx, &p,
		`SELECT * FROM policies WHERE id = $1 AND deleted_at IS NULL`, id)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return &p, err
}

func (s *PolicyStore) Update(ctx context.Context, p *models.Policy) error {
	query := `
		UPDATE policies SET
			name = :name, description = :description, algorithm = :algorithm,
			limit_count = :limit_count, window_seconds = :window_seconds,
			burst_capacity = :burst_capacity, refill_rate = :refill_rate,
			request_cost = :request_cost, key_pattern = :key_pattern,
			failure_mode = :failure_mode, dimensions = :dimensions,
			is_active = :is_active, updated_at = NOW()
		WHERE id = :id AND deleted_at IS NULL
	`
	_, err := s.db.NamedExecContext(ctx, query, p)
	return err
}

func (s *PolicyStore) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE policies SET deleted_at = NOW() WHERE id = $1`, id)
	return err
}

func (s *PolicyStore) List(ctx context.Context, page, pageSize int) ([]*models.Policy, int64, error) {
	offset := (page - 1) * pageSize
	var policies []*models.Policy
	err := s.db.SelectContext(ctx, &policies,
		`SELECT * FROM policies WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
		pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	var total int64
	err = s.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM policies WHERE deleted_at IS NULL`)
	return policies, total, err
}

func (s *PolicyStore) ListActive(ctx context.Context) ([]*models.Policy, error) {
	var policies []*models.Policy
	err := s.db.SelectContext(ctx, &policies,
		`SELECT * FROM policies WHERE is_active = TRUE AND deleted_at IS NULL`)
	return policies, err
}

// RouteStore handles route persistence.
type RouteStore struct {
	db *DB
}

func NewRouteStore(db *DB) *RouteStore {
	return &RouteStore{db: db}
}

func (s *RouteStore) Create(ctx context.Context, r *models.Route) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	query := `
		INSERT INTO routes (
			id, name, description, path_prefix, exact_path, methods,
			backend_id, strip_prefix, policy_id, request_cost, requires_auth,
			allowed_roles, request_headers, response_headers, max_body_size,
			timeout, is_active, priority
		) VALUES (
			:id, :name, :description, :path_prefix, :exact_path, :methods,
			:backend_id, :strip_prefix, :policy_id, :request_cost, :requires_auth,
			:allowed_roles, :request_headers, :response_headers, :max_body_size,
			:timeout, :is_active, :priority
		)
	`
	_, err := s.db.NamedExecContext(ctx, query, r)
	return err
}

func (s *RouteStore) GetByID(ctx context.Context, id uuid.UUID) (*models.Route, error) {
	var r models.Route
	err := s.db.GetContext(ctx, &r,
		`SELECT * FROM routes WHERE id = $1 AND deleted_at IS NULL`, id)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return &r, err
}

func (s *RouteStore) Update(ctx context.Context, r *models.Route) error {
	query := `
		UPDATE routes SET
			name = :name, description = :description, path_prefix = :path_prefix,
			exact_path = :exact_path, methods = :methods, backend_id = :backend_id,
			strip_prefix = :strip_prefix, policy_id = :policy_id,
			request_cost = :request_cost, requires_auth = :requires_auth,
			allowed_roles = :allowed_roles, request_headers = :request_headers,
			response_headers = :response_headers, max_body_size = :max_body_size,
			timeout = :timeout, is_active = :is_active, priority = :priority,
			updated_at = NOW()
		WHERE id = :id AND deleted_at IS NULL
	`
	_, err := s.db.NamedExecContext(ctx, query, r)
	return err
}

func (s *RouteStore) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE routes SET deleted_at = NOW() WHERE id = $1`, id)
	return err
}

func (s *RouteStore) List(ctx context.Context, page, pageSize int) ([]*models.Route, int64, error) {
	offset := (page - 1) * pageSize
	var routes []*models.Route
	err := s.db.SelectContext(ctx, &routes,
		`SELECT * FROM routes WHERE deleted_at IS NULL ORDER BY priority DESC, created_at DESC LIMIT $1 OFFSET $2`,
		pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	var total int64
	err = s.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM routes WHERE deleted_at IS NULL`)
	return routes, total, err
}

func (s *RouteStore) ListActive(ctx context.Context) ([]*models.Route, error) {
	var routes []*models.Route
	err := s.db.SelectContext(ctx, &routes,
		`SELECT * FROM routes WHERE is_active = TRUE AND deleted_at IS NULL ORDER BY priority DESC`)
	return routes, err
}

// BackendStore handles backend service persistence.
type BackendStore struct {
	db *DB
}

func NewBackendStore(db *DB) *BackendStore {
	return &BackendStore{db: db}
}

func (s *BackendStore) Create(ctx context.Context, b *models.BackendService) error {
	if b.ID == uuid.Nil {
		b.ID = uuid.New()
	}
	query := `
		INSERT INTO backend_services (
			id, name, description, targets, load_balancing_policy,
			health_check_path, health_check_interval, connect_timeout,
			response_timeout, max_retries, retry_on, is_active
		) VALUES (
			:id, :name, :description, :targets, :load_balancing_policy,
			:health_check_path, :health_check_interval, :connect_timeout,
			:response_timeout, :max_retries, :retry_on, :is_active
		)
	`
	_, err := s.db.NamedExecContext(ctx, query, b)
	return err
}

func (s *BackendStore) GetByID(ctx context.Context, id uuid.UUID) (*models.BackendService, error) {
	var b models.BackendService
	err := s.db.GetContext(ctx, &b,
		`SELECT * FROM backend_services WHERE id = $1 AND deleted_at IS NULL`, id)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return &b, err
}

func (s *BackendStore) Update(ctx context.Context, b *models.BackendService) error {
	query := `
		UPDATE backend_services SET
			name = :name, description = :description, targets = :targets,
			load_balancing_policy = :load_balancing_policy,
			health_check_path = :health_check_path,
			health_check_interval = :health_check_interval,
			connect_timeout = :connect_timeout, response_timeout = :response_timeout,
			max_retries = :max_retries, retry_on = :retry_on,
			is_active = :is_active, updated_at = NOW()
		WHERE id = :id AND deleted_at IS NULL
	`
	_, err := s.db.NamedExecContext(ctx, query, b)
	return err
}

func (s *BackendStore) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE backend_services SET deleted_at = NOW() WHERE id = $1`, id)
	return err
}

func (s *BackendStore) List(ctx context.Context, page, pageSize int) ([]*models.BackendService, int64, error) {
	offset := (page - 1) * pageSize
	var backends []*models.BackendService
	err := s.db.SelectContext(ctx, &backends,
		`SELECT * FROM backend_services WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
		pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	var total int64
	err = s.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM backend_services WHERE deleted_at IS NULL`)
	return backends, total, err
}

func (s *BackendStore) ListActive(ctx context.Context) ([]*models.BackendService, error) {
	var backends []*models.BackendService
	err := s.db.SelectContext(ctx, &backends,
		`SELECT * FROM backend_services WHERE is_active = TRUE AND deleted_at IS NULL`)
	return backends, err
}

// APIKeyStore handles API key persistence.
type APIKeyStore struct {
	db *DB
}

func NewAPIKeyStore(db *DB) *APIKeyStore {
	return &APIKeyStore{db: db}
}

func (s *APIKeyStore) Create(ctx context.Context, k *models.APIKey) error {
	if k.ID == uuid.Nil {
		k.ID = uuid.New()
	}
	query := `
		INSERT INTO api_keys (
			id, name, description, key_hash, key_prefix, tenant_id,
			user_id, policy_id, expires_at
		) VALUES (
			:id, :name, :description, :key_hash, :key_prefix, :tenant_id,
			:user_id, :policy_id, :expires_at
		)
	`
	_, err := s.db.NamedExecContext(ctx, query, k)
	return err
}

func (s *APIKeyStore) GetByHash(ctx context.Context, hash string) (*models.APIKey, error) {
	var k models.APIKey
	err := s.db.GetContext(ctx, &k, `SELECT * FROM api_keys WHERE key_hash = $1`, hash)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return &k, err
}

func (s *APIKeyStore) GetByID(ctx context.Context, id uuid.UUID) (*models.APIKey, error) {
	var k models.APIKey
	err := s.db.GetContext(ctx, &k, `SELECT * FROM api_keys WHERE id = $1`, id)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return &k, err
}

func (s *APIKeyStore) Revoke(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE api_keys SET revoked_at = $1, updated_at = NOW() WHERE id = $2`, now, id)
	return err
}

func (s *APIKeyStore) UpdateLastUsed(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE api_keys SET last_used_at = $1 WHERE id = $2`, now, id)
	return err
}

func (s *APIKeyStore) ListByTenant(ctx context.Context, tenantID uuid.UUID, page, pageSize int) ([]*models.APIKey, int64, error) {
	offset := (page - 1) * pageSize
	var keys []*models.APIKey
	err := s.db.SelectContext(ctx, &keys,
		`SELECT * FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		tenantID, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	var total int64
	err = s.db.GetContext(ctx, &total,
		`SELECT COUNT(*) FROM api_keys WHERE tenant_id = $1`, tenantID)
	return keys, total, err
}

func (s *APIKeyStore) ListAll(ctx context.Context, page, pageSize int) ([]*models.APIKey, int64, error) {
	offset := (page - 1) * pageSize
	var keys []*models.APIKey
	if err := s.db.SelectContext(ctx, &keys,
		`SELECT * FROM api_keys ORDER BY created_at DESC LIMIT $1 OFFSET $2`, pageSize, offset); err != nil {
		return nil, 0, err
	}
	var total int64
	if err := s.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM api_keys`); err != nil {
		return nil, 0, err
	}
	return keys, total, nil
}

// TenantStore handles tenant persistence.
type TenantStore struct {
	db *DB
}

func NewTenantStore(db *DB) *TenantStore {
	return &TenantStore{db: db}
}

func (s *TenantStore) Create(ctx context.Context, t *models.Tenant) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	query := `
		INSERT INTO tenants (id, name, slug, plan_id, is_active, metadata)
		VALUES (:id, :name, :slug, :plan_id, :is_active, :metadata)
	`
	_, err := s.db.NamedExecContext(ctx, query, t)
	return err
}

func (s *TenantStore) GetByID(ctx context.Context, id uuid.UUID) (*models.Tenant, error) {
	var t models.Tenant
	err := s.db.GetContext(ctx, &t,
		`SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL`, id)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return &t, err
}

func (s *TenantStore) Update(ctx context.Context, t *models.Tenant) error {
	query := `
		UPDATE tenants SET name = :name, slug = :slug, plan_id = :plan_id,
			is_active = :is_active, metadata = :metadata, updated_at = NOW()
		WHERE id = :id AND deleted_at IS NULL
	`
	_, err := s.db.NamedExecContext(ctx, query, t)
	return err
}

func (s *TenantStore) List(ctx context.Context, page, pageSize int) ([]*models.Tenant, int64, error) {
	offset := (page - 1) * pageSize
	var tenants []*models.Tenant
	err := s.db.SelectContext(ctx, &tenants,
		`SELECT * FROM tenants WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
		pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	var total int64
	err = s.db.GetContext(ctx, &total, `SELECT COUNT(*) FROM tenants WHERE deleted_at IS NULL`)
	return tenants, total, err
}

// AuditLogStore handles audit log persistence.
type AuditLogStore struct {
	db *DB
}

func NewAuditLogStore(db *DB) *AuditLogStore {
	return &AuditLogStore{db: db}
}

func (s *AuditLogStore) Create(ctx context.Context, entry *models.AuditLog) error {
	if entry.ID == uuid.Nil {
		entry.ID = uuid.New()
	}
	query := `
		INSERT INTO audit_logs (
			id, user_id, tenant_id, action, resource, resource_id,
			ip_address, user_agent, changes, status
		) VALUES (
			:id, :user_id, :tenant_id, :action, :resource, :resource_id,
			:ip_address, :user_agent, :changes, :status
		)
	`
	_, err := s.db.NamedExecContext(ctx, query, entry)
	return err
}

func (s *AuditLogStore) List(ctx context.Context, page, pageSize int, filters AuditFilters) ([]*models.AuditLog, int64, error) {
	offset := (page - 1) * pageSize
	where := "WHERE 1=1"
	args := []interface{}{}
	argN := 1

	if filters.Action != "" {
		where += fmt.Sprintf(" AND action = $%d", argN)
		args = append(args, filters.Action)
		argN++
	}
	if filters.Resource != "" {
		where += fmt.Sprintf(" AND resource = $%d", argN)
		args = append(args, filters.Resource)
		argN++
	}

	var logs []*models.AuditLog
	query := fmt.Sprintf(
		`SELECT * FROM audit_logs %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d`,
		where, argN, argN+1,
	)
	args = append(args, pageSize, offset)
	err := s.db.SelectContext(ctx, &logs, query, args...)
	if err != nil {
		return nil, 0, err
	}

	var total int64
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM audit_logs %s`, where)
	err = s.db.GetContext(ctx, &total, countQuery, args[:len(args)-2]...)
	return logs, total, err
}

// AuditFilters is used to filter audit log queries.
type AuditFilters struct {
	Action   string
	Resource string
	UserID   string
}

// RefreshTokenStore handles refresh token persistence.
type RefreshTokenStore struct {
	db *DB
}

func NewRefreshTokenStore(db *DB) *RefreshTokenStore {
	return &RefreshTokenStore{db: db}
}

func (s *RefreshTokenStore) Create(ctx context.Context, t *models.RefreshToken) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	_, err := s.db.NamedExecContext(ctx, `
		INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
		VALUES (:id, :user_id, :token_hash, :expires_at)
	`, t)
	return err
}

func (s *RefreshTokenStore) GetByHash(ctx context.Context, hash string) (*models.RefreshToken, error) {
	var t models.RefreshToken
	err := s.db.GetContext(ctx, &t,
		`SELECT * FROM refresh_tokens WHERE token_hash = $1`, hash)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return &t, err
}

func (s *RefreshTokenStore) Revoke(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked_at = $1 WHERE id = $2`, now, id)
	return err
}

func (s *RefreshTokenStore) RevokeAllForUser(ctx context.Context, userID uuid.UUID) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`, now, userID)
	return err
}

// ErrNotFound is returned when a record is not found.
var ErrNotFound = fmt.Errorf("record not found")
