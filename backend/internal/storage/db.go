// Package storage provides PostgreSQL-backed persistence for the control plane.
package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"github.com/rs/zerolog/log"

	"github.com/rate-limiter/gateway/internal/config"
)

// DB wraps sqlx.DB to provide a uniform interface for the application.
type DB struct {
	*sqlx.DB
}

// Connect establishes a database connection pool and verifies connectivity.
func Connect(cfg config.DatabaseConfig) (*DB, error) {
	db, err := sqlx.Connect("postgres", cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}

	db.SetMaxOpenConns(cfg.MaxOpenConns)
	db.SetMaxIdleConns(cfg.MaxIdleConns)
	db.SetConnMaxLifetime(cfg.ConnMaxLifetime)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	log.Info().
		Str("host", cfg.Host).
		Int("port", cfg.Port).
		Str("database", cfg.Database).
		Msg("connected to PostgreSQL")

	return &DB{db}, nil
}

// Migrate runs all pending database migrations from the given source directory.
func Migrate(cfg config.DatabaseConfig, migrationsDir string) error {
	sourceURL := "file://" + migrationsDir
	m, err := migrate.New(sourceURL, cfg.MigrationURL())
	if err != nil {
		return fmt.Errorf("create migrator: %w", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("run migrations: %w", err)
	}

	version, dirty, err := m.Version()
	if err != nil && err != migrate.ErrNilVersion {
		return fmt.Errorf("get migration version: %w", err)
	}

	log.Info().
		Uint("version", version).
		Bool("dirty", dirty).
		Msg("database migrations applied")

	return nil
}

// Healthy returns true if the database is reachable.
func (db *DB) Healthy(ctx context.Context) bool {
	return db.PingContext(ctx) == nil
}
