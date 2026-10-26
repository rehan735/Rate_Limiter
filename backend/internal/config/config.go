package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/kelseyhightower/envconfig"
)

// Config holds the complete application configuration loaded from environment variables.
type Config struct {
	App         AppConfig
	Gateway     GatewayConfig
	ControlPlane ControlPlaneConfig
	Database    DatabaseConfig
	Redis       RedisConfig
	JWT         JWTConfig
	Admin       AdminConfig
	RateLimit   RateLimitConfig
	Observability ObservabilityConfig
}

type AppConfig struct {
	Env       string `envconfig:"APP_ENV" default:"development"`
	LogLevel  string `envconfig:"LOG_LEVEL" default:"info"`
	LogFormat string `envconfig:"LOG_FORMAT" default:"json"`
}

type GatewayConfig struct {
	HTTPPort         int           `envconfig:"GATEWAY_HTTP_PORT" default:"8080"`
	MetricsPort      int           `envconfig:"GATEWAY_METRICS_PORT" default:"9090"`
	ReadTimeout      time.Duration `envconfig:"GATEWAY_READ_TIMEOUT" default:"30s"`
	WriteTimeout     time.Duration `envconfig:"GATEWAY_WRITE_TIMEOUT" default:"30s"`
	IdleTimeout      time.Duration `envconfig:"GATEWAY_IDLE_TIMEOUT" default:"120s"`
	MaxRequestSize   int64         `envconfig:"GATEWAY_MAX_REQUEST_SIZE" default:"10485760"`
	ShutdownTimeout  time.Duration `envconfig:"GATEWAY_SHUTDOWN_TIMEOUT" default:"30s"`
	TrustedProxies      []string      `envconfig:"GATEWAY_TRUSTED_PROXIES"`
	AllowPrivateBackends bool         `envconfig:"GATEWAY_ALLOW_PRIVATE_BACKENDS" default:"false"`
	BackendAllowedCIDRs  []string     `envconfig:"GATEWAY_BACKEND_ALLOWED_CIDRS"`
	MaxConcurrentRequests int          `envconfig:"GATEWAY_MAX_CONCURRENT_REQUESTS" default:"10000"`
}


type ControlPlaneConfig struct {
	Port        int      `envconfig:"CONTROL_PLANE_PORT" default:"8081"`
	CORSOrigins []string `envconfig:"CONTROL_PLANE_CORS_ORIGINS"`
}

type DatabaseConfig struct {
	Host            string        `envconfig:"POSTGRES_HOST" default:"localhost"`
	Port            int           `envconfig:"POSTGRES_PORT" default:"5432"`
	Database        string        `envconfig:"POSTGRES_DB" default:"ratelimiter"`
	User            string        `envconfig:"POSTGRES_USER" default:"ratelimiter"`
	Password        string        `envconfig:"POSTGRES_PASSWORD" required:"true"`
	SSLMode         string        `envconfig:"POSTGRES_SSLMODE" default:"disable"`
	MaxOpenConns    int           `envconfig:"POSTGRES_MAX_OPEN_CONNS" default:"25"`
	MaxIdleConns    int           `envconfig:"POSTGRES_MAX_IDLE_CONNS" default:"10"`
	ConnMaxLifetime time.Duration `envconfig:"POSTGRES_CONN_LIFETIME" default:"5m"`
}

func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d dbname=%s user=%s password=%s sslmode=%s",
		d.Host, d.Port, d.Database, d.User, d.Password, d.SSLMode,
	)
}

func (d DatabaseConfig) MigrationURL() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		d.User, d.Password, d.Host, d.Port, d.Database, d.SSLMode,
	)
}

type RedisConfig struct {
	Addr          string        `envconfig:"REDIS_ADDR" default:"localhost:6379"`
	Password      string        `envconfig:"REDIS_PASSWORD" default:""`
	DB            int           `envconfig:"REDIS_DB" default:"0"`
	MaxRetries    int           `envconfig:"REDIS_MAX_RETRIES" default:"3"`
	DialTimeout   time.Duration `envconfig:"REDIS_DIAL_TIMEOUT" default:"5s"`
	ReadTimeout   time.Duration `envconfig:"REDIS_READ_TIMEOUT" default:"3s"`
	WriteTimeout  time.Duration `envconfig:"REDIS_WRITE_TIMEOUT" default:"3s"`
	PoolSize      int           `envconfig:"REDIS_POOL_SIZE" default:"20"`
	MinIdleConns  int           `envconfig:"REDIS_MIN_IDLE_CONNS" default:"5"`
	FailurePolicy string        `envconfig:"REDIS_FAILURE_POLICY" default:"fail_open"`
}

type JWTConfig struct {
	PrivateKeyPath  string        `envconfig:"JWT_PRIVATE_KEY_PATH" default:"/secrets/jwt_private.pem"`
	PublicKeyPath   string        `envconfig:"JWT_PUBLIC_KEY_PATH" default:"/secrets/jwt_public.pem"`
	AccessTokenTTL  time.Duration `envconfig:"JWT_ACCESS_TOKEN_TTL" default:"15m"`
	RefreshTokenTTL time.Duration `envconfig:"JWT_REFRESH_TOKEN_TTL" default:"168h"`
	Issuer          string        `envconfig:"JWT_ISSUER" default:"rate-limiter-gateway"`
	AllowEphemeral  bool          `envconfig:"JWT_ALLOW_EPHEMERAL" default:"false"`
}

type AdminConfig struct {
	Email    string `envconfig:"ADMIN_EMAIL" default:"admin@example.com"`
	Password string `envconfig:"ADMIN_PASSWORD" required:"true"`
}

type RateLimitConfig struct {
	DefaultAlgorithm   string `envconfig:"DEFAULT_RATE_LIMIT_ALGORITHM" default:"token_bucket"`
	DefaultLimit       int    `envconfig:"DEFAULT_RATE_LIMIT" default:"1000"`
	DefaultBurst       int    `envconfig:"DEFAULT_BURST_CAPACITY" default:"100"`
}

type ObservabilityConfig struct {
	OTLPEndpoint   string `envconfig:"OTEL_EXPORTER_OTLP_ENDPOINT" default:"http://localhost:4317"`
	ServiceName    string `envconfig:"OTEL_SERVICE_NAME" default:"api-gateway"`
	ServiceVersion string `envconfig:"OTEL_SERVICE_VERSION" default:"0.1.0"`
}

// Load reads configuration from environment variables.
func Load() (*Config, error) {
	cfg := &Config{}

	sections := []interface{}{
		&cfg.App,
		&cfg.Gateway,
		&cfg.ControlPlane,
		&cfg.Database,
		&cfg.Redis,
		&cfg.JWT,
		&cfg.Admin,
		&cfg.RateLimit,
		&cfg.Observability,
	}

	for _, s := range sections {
		if err := envconfig.Process("", s); err != nil {
			return nil, fmt.Errorf("config load: %w", err)
		}
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

// LoadFromFile reads a .env file and then loads configuration. Useful in development.
func LoadFromFile(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		// Not fatal — .env file is optional
		return Load()
	}

	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		// Strip inline comments
		if idx := strings.Index(val, " #"); idx != -1 {
			val = strings.TrimSpace(val[:idx])
		}
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}

	return Load()
}

func (c *Config) validate() error {
	policy := c.Redis.FailurePolicy
	valid := map[string]bool{"fail_open": true, "fail_closed": true, "local_fallback": true}
	if !valid[policy] {
		return fmt.Errorf("invalid REDIS_FAILURE_POLICY %q; must be fail_open, fail_closed, or local_fallback", policy)
	}

	algo := c.RateLimit.DefaultAlgorithm
	validAlgos := map[string]bool{
		"token_bucket":         true,
		"fixed_window":         true,
		"sliding_window":       true,
		"sliding_window_log":   true,
	}
	if !validAlgos[algo] {
		return fmt.Errorf("invalid DEFAULT_RATE_LIMIT_ALGORITHM %q", algo)
	}

	return nil
}

func (c *Config) IsDevelopment() bool {
	return c.App.Env == "development"
}
