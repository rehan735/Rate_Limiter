// Package auth handles JWT token generation/validation and password hashing.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"

	"github.com/rate-limiter/gateway/internal/config"
	"github.com/rate-limiter/gateway/internal/models"
)

// Claims is the JWT payload for access tokens.
type Claims struct {
	jwt.RegisteredClaims
	UserID   uuid.UUID    `json:"uid"`
	Role     models.Role  `json:"role"`
	TenantID *uuid.UUID   `json:"tid,omitempty"`
}

// TokenPair is an access + refresh token pair returned at login.
type TokenPair struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
}

// Service provides authentication operations.
type Service struct {
	privateKey *rsa.PrivateKey
	publicKey  *rsa.PublicKey
	cfg        config.JWTConfig
}

// NewService loads RSA keys and returns an auth service.
// If key files don't exist, it generates ephemeral keys suitable for development.
func NewService(cfg config.JWTConfig) (*Service, error) {
	var privateKey *rsa.PrivateKey
	var publicKey *rsa.PublicKey

	privBytes, errPriv := os.ReadFile(cfg.PrivateKeyPath)
	pubBytes, errPub := os.ReadFile(cfg.PublicKeyPath)

	if errPriv != nil || errPub != nil {
		if !cfg.AllowEphemeral {
			return nil, fmt.Errorf("JWT key files are required; set JWT_ALLOW_EPHEMERAL=true only for local development")
		}
		// Ephemeral keys are explicitly allowed only for local development.
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return nil, fmt.Errorf("generate ephemeral RSA key: %w", err)
		}
		privateKey = key
		publicKey = &key.PublicKey
	} else {
		var err error
		parsed, err := jwt.ParseRSAPrivateKeyFromPEM(privBytes)
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		privateKey = parsed

		parsedPub, err := jwt.ParseRSAPublicKeyFromPEM(pubBytes)
		if err != nil {
			return nil, fmt.Errorf("parse public key: %w", err)
		}
		publicKey = parsedPub
		if !privateKey.PublicKey.Equal(publicKey) {
			return nil, fmt.Errorf("JWT private and public key files do not match")
		}
	}

	return &Service{
		privateKey: privateKey,
		publicKey:  publicKey,
		cfg:        cfg,
	}, nil
}

// GenerateTokenPair creates a new access token and an opaque refresh token.
func (s *Service) GenerateTokenPair(user *models.User) (*TokenPair, string, error) {
	accessToken, expiresAt, err := s.generateAccessToken(user)
	if err != nil {
		return nil, "", err
	}

	rawRefresh, refreshHash, err := generateRefreshToken()
	if err != nil {
		return nil, "", err
	}

	return &TokenPair{
		AccessToken:  accessToken,
		RefreshToken: rawRefresh,
		ExpiresAt:    expiresAt,
	}, refreshHash, nil
}

func (s *Service) generateAccessToken(user *models.User) (string, time.Time, error) {
	expiresAt := time.Now().Add(s.cfg.AccessTokenTTL)
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.cfg.Issuer,
			Subject:   user.ID.String(),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			ID:        uuid.New().String(),
		},
		UserID:   user.ID,
		Role:     user.Role,
		TenantID: user.TenantID,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := token.SignedString(s.privateKey)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign token: %w", err)
	}
	return signed, expiresAt, nil
}

// ValidateToken parses and validates an access token, returning its claims.
func (s *Service) ValidateToken(ctx context.Context, tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if t.Method != jwt.SigningMethodRS256 {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.publicKey, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}), jwt.WithIssuer(s.cfg.Issuer))
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	return claims, nil
}

// HashPassword hashes a plaintext password using Argon2id.
// Parameters are conservative for 2024-era hardware.
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}

	// Argon2id: memory=64MB, iterations=3, parallelism=4
	hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)

	encoded := fmt.Sprintf("$argon2id$v=%d$m=65536,t=3,p=4$%s$%s",
		argon2.Version,
		hex.EncodeToString(salt),
		hex.EncodeToString(hash),
	)
	return encoded, nil
}

// VerifyPassword compares a plaintext password against an Argon2id hash.
func VerifyPassword(password, encodedHash string) (bool, error) {
	var version int
	var memory, iterations uint32
	var parallelism uint8
	var saltHex string

	_, err := fmt.Sscanf(encodedHash,
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s",
		&version, &memory, &iterations, &parallelism, &saltHex)

	// The last two fields are dollar-separated
	if err != nil {
		return false, fmt.Errorf("invalid hash format")
	}

	// Extract salt and hash hex from the remaining string
	// Format: salt$hash
	i := len(fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$", version, memory, iterations, parallelism))
	remaining := encodedHash[i:]
	parts := splitLast(remaining, "$")
	if len(parts) != 2 {
		return false, fmt.Errorf("invalid hash format: missing separator")
	}

	salt, err := hex.DecodeString(parts[0])
	if err != nil {
		return false, fmt.Errorf("decode salt: %w", err)
	}
	expectedHash, err := hex.DecodeString(parts[1])
	if err != nil {
		return false, fmt.Errorf("decode hash: %w", err)
	}

	computed := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(expectedHash)))

	// Constant-time comparison
	if len(computed) != len(expectedHash) {
		return false, nil
	}
	for i := range computed {
		if computed[i] != expectedHash[i] {
			return false, nil
		}
	}
	return true, nil
}

// HashAPIKey returns the SHA-256 hash of an API key for storage.
// The full key is shown once at creation and never stored plaintext.
func HashAPIKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

// GenerateAPIKey returns a random API key (raw) and its 8-char prefix for display.
func GenerateAPIKey() (raw, prefix string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", fmt.Errorf("generate api key: %w", err)
	}
	raw = "rl_" + hex.EncodeToString(b)
	prefix = raw[:11] // "rl_" + first 8 hex chars
	return raw, prefix, nil
}

func generateRefreshToken() (raw, hash string, err error) {
	b := make([]byte, 40)
	if _, err = rand.Read(b); err != nil {
		return "", "", fmt.Errorf("generate refresh token: %w", err)
	}
	raw = hex.EncodeToString(b)
	h := sha256.Sum256([]byte(raw))
	hash = hex.EncodeToString(h[:])
	return raw, hash, nil
}

// HashRefreshToken returns the SHA-256 hash of a refresh token for storage.
func HashRefreshToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func splitLast(s, sep string) []string {
	idx := len(s) - 1
	for idx >= 0 {
		if string(s[idx]) == sep {
			return []string{s[:idx], s[idx+1:]}
		}
		idx--
	}
	return []string{s}
}
