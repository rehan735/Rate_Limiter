# syntax=docker/dockerfile:1
# =============================================================================
# Stage 1: Build
# =============================================================================
FROM golang:1.22-alpine AS builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

# Download dependencies (cached layer)
COPY go.mod go.sum* ./
RUN go mod download

# Copy source
COPY . .

# Build the binary with optimizations and version injection
ARG VERSION=0.1.0
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s -X main.version=${VERSION}" \
    -o /app/gateway ./cmd/gateway/

# =============================================================================
# Stage 2: Runtime (minimal image)
# =============================================================================
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

# Copy binary and static assets
COPY --from=builder /app/gateway .
COPY --from=builder /build/migrations ./migrations
COPY --from=builder /build/scripts ./scripts
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

# Run as non-root
USER nonroot:nonroot

EXPOSE 8080 8081 9090

ENTRYPOINT ["/app/gateway"]
