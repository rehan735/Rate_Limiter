package unit

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rate-limiter/gateway/internal/auth"
	"github.com/rate-limiter/gateway/internal/config"
	"github.com/rate-limiter/gateway/internal/models"
)

func TestAuthService_PasswordHashing(t *testing.T) {
	password := "SecureAdminP@ssw0rd!"
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("failed to hash password: %v", err)
	}

	// Verify valid password matches
	match, err := auth.VerifyPassword(password, hash)
	if err != nil {
		t.Fatalf("failed to verify password: %v", err)
	}
	if !match {
		t.Errorf("expected valid password to match hash")
	}

	// Verify wrong password fails
	wrongMatch, _ := auth.VerifyPassword("WrongPassword123", hash)
	if wrongMatch {
		t.Errorf("expected incorrect password verification to fail")
	}
}

func TestAuthService_JWTTokenLifecycle(t *testing.T) {
	service, err := auth.NewService(config.JWTConfig{
		AccessTokenTTL: 1 * time.Hour,
		Issuer:         "test-gateway",
		AllowEphemeral: true,
	})
	if err != nil {
		t.Fatalf("failed to create auth service: %v", err)
	}

	userID := uuid.New()
	user := &models.User{
		ID:    userID,
		Email: "admin@example.com",
		Role:  models.RoleAdmin,
	}

	tokenPair, refreshHash, err := service.GenerateTokenPair(user)
	if err != nil {
		t.Fatalf("failed to generate token pair: %v", err)
	}

	if tokenPair.AccessToken == "" {
		t.Errorf("expected non-empty access token")
	}
	if refreshHash == "" {
		t.Errorf("expected non-empty refresh token hash")
	}

	// Validate access token claims
	ctx := context.Background()
	claims, err := service.ValidateToken(ctx, tokenPair.AccessToken)
	if err != nil {
		t.Fatalf("failed to validate token: %v", err)
	}

	if claims.UserID != userID {
		t.Errorf("expected user ID %v, got %v", userID, claims.UserID)
	}
	if claims.Role != models.RoleAdmin {
		t.Errorf("expected role admin, got %s", claims.Role)
	}
}
