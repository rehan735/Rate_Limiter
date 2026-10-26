// main.go — Combined gateway + control plane entry point.
// In production, these can be split into separate binaries using build tags.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/redis/go-redis/v9"

	"github.com/rate-limiter/gateway/internal/auth"
	"github.com/rate-limiter/gateway/internal/config"
	"github.com/rate-limiter/gateway/internal/controlplane"
	"github.com/rate-limiter/gateway/internal/gateway"
	"github.com/rate-limiter/gateway/internal/observability"
	"github.com/rate-limiter/gateway/internal/ratelimiter"
	"github.com/rate-limiter/gateway/internal/storage"
)

const (
	version         = "0.1.0"
	migrationsDir   = "./migrations"
	configReloadInterval = 30 * time.Second
)

func main() {
	// --- Logging setup ---
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.With().Str("service", "api-gateway").Str("version", version).Logger()

	// --- Configuration ---
	cfg, err := config.LoadFromFile(".env")
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load configuration")
	}

	if cfg.App.LogFormat == "text" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	level, err := zerolog.ParseLevel(cfg.App.LogLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)

	log.Info().Str("env", cfg.App.Env).Msg("starting api gateway")

	// --- Database ---
	db, err := storage.Connect(cfg.Database)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer db.Close()

	if err := storage.Migrate(cfg.Database, migrationsDir); err != nil {
		log.Fatal().Err(err).Msg("database migration failed")
	}

	// --- Redis ---
	redisClient := redis.NewClient(&redis.Options{
		Addr:         cfg.Redis.Addr,
		Password:     cfg.Redis.Password,
		DB:           cfg.Redis.DB,
		MaxRetries:   cfg.Redis.MaxRetries,
		DialTimeout:  cfg.Redis.DialTimeout,
		ReadTimeout:  cfg.Redis.ReadTimeout,
		WriteTimeout: cfg.Redis.WriteTimeout,
		PoolSize:     cfg.Redis.PoolSize,
		MinIdleConns: cfg.Redis.MinIdleConns,
	})

	ctx := context.Background()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Warn().Err(err).Msg("redis ping failed — gateway will start with configured failure mode")
	} else {
		log.Info().Str("addr", cfg.Redis.Addr).Msg("connected to Redis")
	}
	defer redisClient.Close()

	// --- Tracing ---
	shutdownTracing, err := observability.InitTracing(cfg.Observability)
	if err != nil {
		log.Warn().Err(err).Msg("tracing initialization failed — continuing without traces")
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if shutdownTracing != nil {
			_ = shutdownTracing(shutdownCtx)
		}
	}()

	// --- Auth service ---
	authSvc, err := auth.NewService(cfg.JWT)
	if err != nil {
		log.Fatal().Err(err).Msg("auth service initialization failed")
	}

	// --- Storage layer ---
	userStore     := storage.NewUserStore(db)
	policyStore   := storage.NewPolicyStore(db)
	routeStore    := storage.NewRouteStore(db)
	backendStore  := storage.NewBackendStore(db)
	apiKeyStore   := storage.NewAPIKeyStore(db)
	tenantStore   := storage.NewTenantStore(db)
	auditStore    := storage.NewAuditLogStore(db)
	rtStore       := storage.NewRefreshTokenStore(db)

	// --- Bootstrap admin user ---
	if err := bootstrapAdmin(ctx, userStore, cfg.Admin); err != nil {
		log.Warn().Err(err).Msg("admin bootstrap")
	}

	// --- Rate-limiter factory ---
	failureMode := ratelimiter.FailureMode(cfg.Redis.FailurePolicy)
	limiterFactory := ratelimiter.NewFactory(redisClient, failureMode)

	// --- Gateway data plane ---
	gatewaySrv := gateway.NewServer(
		cfg, authSvc, limiterFactory,
		routeStore, backendStore, policyStore, apiKeyStore,
	)
	if err := gatewaySrv.LoadRoutes(ctx); err != nil {
		log.Warn().Err(err).Msg("initial route load failed — gateway will have no routes")
	}

	// --- Control plane ---
	cpSrv := controlplane.NewServer(
		cfg, authSvc,
		userStore, policyStore, routeStore, backendStore,
		apiKeyStore, tenantStore, auditStore, rtStore,
	)
	cpSrv.SetReloadFn(gatewaySrv.LoadRoutes)
	cpSrv.SetRedisClient(redisClient)


	// --- HTTP servers ---
	gatewayHTTP := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Gateway.HTTPPort),
		Handler:      gatewaySrv.BuildHTTPHandler(),
		ReadTimeout:  cfg.Gateway.ReadTimeout,
		WriteTimeout: cfg.Gateway.WriteTimeout,
		IdleTimeout:  cfg.Gateway.IdleTimeout,
	}

	controlPlaneHTTP := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.ControlPlane.Port),
		Handler:      cpSrv,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	metricsHTTP := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Gateway.MetricsPort),
		Handler: observability.MetricsHandler(),
	}

	// --- Graceful shutdown context ---
	mainCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// --- Start background reload ---
	reloadCtx, cancelReload := context.WithCancel(mainCtx)
	defer cancelReload()
	go gatewaySrv.PeriodicReload(reloadCtx, configReloadInterval)
	go gatewaySrv.PeriodicHealthCheck(reloadCtx, 10*time.Second)

	// --- Start servers ---
	log.Info().Int("port", cfg.Gateway.HTTPPort).Msg("starting gateway data plane")
	go func() {
		if err := gatewayHTTP.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("gateway server error")
		}
	}()

	log.Info().Int("port", cfg.ControlPlane.Port).Msg("starting control plane")
	go func() {
		if err := controlPlaneHTTP.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("control plane server error")
		}
	}()

	log.Info().Int("port", cfg.Gateway.MetricsPort).Msg("starting metrics server")
	go func() {
		if err := metricsHTTP.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error().Err(err).Msg("metrics server error")
		}
	}()

	// --- Wait for shutdown signal ---
	<-mainCtx.Done()
	log.Info().Msg("shutdown signal received")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.Gateway.ShutdownTimeout)
	defer cancel()

	if err := gatewayHTTP.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("gateway shutdown error")
	}
	if err := controlPlaneHTTP.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("control plane shutdown error")
	}
	if err := metricsHTTP.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("metrics shutdown error")
	}

	log.Info().Msg("shutdown complete")
}

// bootstrapAdmin creates the initial administrator account if none exists.
func bootstrapAdmin(ctx context.Context, userStore *storage.UserStore, cfg config.AdminConfig) error {
	_, err := userStore.GetByEmail(ctx, cfg.Email)
	if err == nil {
		// Admin already exists
		return nil
	}
	if err != storage.ErrNotFound {
		return fmt.Errorf("check admin user: %w", err)
	}

	hash, err := auth.HashPassword(cfg.Password)
	if err != nil {
		return fmt.Errorf("hash admin password: %w", err)
	}

	if err := userStore.CreateRaw(ctx, cfg.Email, hash, "admin"); err != nil {
		return fmt.Errorf("create admin user: %w", err)
	}

	log.Info().Str("email", cfg.Email).Msg("admin user created")
	return nil
}
