package controlplane

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rate-limiter/gateway/internal/config"
)

func TestMetricsAndReloadRequireAuthentication(t *testing.T) {
	server := NewServer(&config.Config{}, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	for _, test := range []struct { method, path string }{
		{http.MethodGet, "/api/v1/metrics/summary"},
		{http.MethodPost, "/api/v1/admin/reload"},
	} {
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, nil))
		if recorder.Code != http.StatusUnauthorized {
			t.Errorf("%s %s returned %d, want 401", test.method, test.path, recorder.Code)
		}
	}
}
