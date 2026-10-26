// StatusRecordingWriter is an http.ResponseWriter that captures the status code for metrics.
package observability

import "net/http"

// StatusRecordingWriter wraps ResponseWriter to capture the response status code.
type StatusRecordingWriter struct {
	http.ResponseWriter
	statusCode int
	written    bool
}

func (w *StatusRecordingWriter) WriteHeader(code int) {
	if !w.written {
		w.statusCode = code
		w.written = true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *StatusRecordingWriter) Write(b []byte) (int, error) {
	if !w.written {
		w.statusCode = http.StatusOK
		w.written = true
	}
	return w.ResponseWriter.Write(b)
}

func (w *StatusRecordingWriter) StatusCode() int {
	if w.statusCode == 0 {
		return http.StatusOK
	}
	return w.statusCode
}
