import React, { useState, useEffect } from 'react'
import {
  Pause,
  Play,
  Trash2,
  Search,
  X
} from 'lucide-react'

interface TrafficEvent {
  id: string
  timestamp: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  clientIp: string
  apiKey: string
  algorithm: string
  quotaUsed: string
  latencyMs: number
  status: 200 | 429 | 503
  reason?: string
  headers?: Record<string, string>
}

export const TrafficInspectorPage: React.FC = () => {
  const [isStreaming, setIsStreaming] = useState(true)
  const [filterStatus, setFilterStatus] = useState<'all' | '200' | '429' | '503'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEvent, setSelectedEvent] = useState<TrafficEvent | null>(null)
  const [events, setEvents] = useState<TrafficEvent[]>([])

  // Seed initial traffic events
  useEffect(() => {
    const initialEvents: TrafficEvent[] = [
      {
        id: 'evt-1',
        timestamp: new Date().toISOString().substring(11, 23),
        method: 'POST',
        path: '/api/v1/embeddings',
        clientIp: '54.218.112.4',
        apiKey: 'rs_live_embed_99a',
        algorithm: 'Token Bucket',
        quotaUsed: '248/250',
        latencyMs: 1.15,
        status: 200,
        headers: {
          'X-RateLimit-Limit': '250',
          'X-RateLimit-Remaining': '2',
          'X-RateLimit-Reset': '1s',
          'Content-Type': 'application/json'
        }
      },
      {
        id: 'evt-2',
        timestamp: new Date(Date.now() - 300).toISOString().substring(11, 23),
        method: 'GET',
        path: '/api/v1/users/profile',
        clientIp: '198.51.100.24',
        apiKey: 'rs_live_user_44b',
        algorithm: 'Sliding Window Counter',
        quotaUsed: '60/60',
        latencyMs: 0.42,
        status: 429,
        reason: 'Tenant RPM quota ceiling exhausted',
        headers: {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'Retry-After': '12',
          'X-RateLimit-Reset': '12s'
        }
      },
      {
        id: 'evt-3',
        timestamp: new Date(Date.now() - 650).toISOString().substring(11, 23),
        method: 'POST',
        path: '/api/v1/payments/charge',
        clientIp: '203.0.113.88',
        apiKey: 'rs_live_fin_28k',
        algorithm: 'Sliding Window Log',
        quotaUsed: '10/10',
        latencyMs: 0.88,
        status: 429,
        reason: 'Strict ZSET sorted window limit exceeded',
        headers: {
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': '0',
          'Retry-After': '60'
        }
      },
      {
        id: 'evt-4',
        timestamp: new Date(Date.now() - 950).toISOString().substring(11, 23),
        method: 'GET',
        path: '/api/v1/orders/ORD-9821',
        clientIp: '192.168.1.105',
        apiKey: 'rs_live_order_11z',
        algorithm: 'Token Bucket',
        quotaUsed: '840/1000',
        latencyMs: 1.84,
        status: 200,
        headers: {
          'X-RateLimit-Limit': '1000',
          'X-RateLimit-Remaining': '160',
          'X-RateLimit-Reset': '24s'
        }
      },
      {
        id: 'evt-5',
        timestamp: new Date(Date.now() - 1300).toISOString().substring(11, 23),
        method: 'POST',
        path: '/api/v1/auth/login',
        clientIp: '198.51.100.99',
        apiKey: 'unauthenticated',
        algorithm: 'Fixed Window',
        quotaUsed: '5/5',
        latencyMs: 0.35,
        status: 429,
        reason: 'Brute-force protection: 5 attempts per 60s per IP',
        headers: {
          'X-RateLimit-Limit': '5',
          'X-RateLimit-Remaining': '0',
          'Retry-After': '45'
        }
      },
      {
        id: 'evt-6',
        timestamp: new Date(Date.now() - 1700).toISOString().substring(11, 23),
        method: 'GET',
        path: '/api/v1/inventory/items',
        clientIp: '172.16.4.12',
        apiKey: 'rs_live_inv_77d',
        algorithm: 'Token Bucket',
        quotaUsed: '100/100',
        latencyMs: 12.4,
        status: 503,
        reason: 'Circuit breaker OPEN for Upstream inventory-service',
        headers: {
          'X-Circuit-Breaker': 'tripped',
          'X-Upstream-Status': 'timeout'
        }
      }
    ]
    setEvents(initialEvents)
  }, [])

  // Live simulation tick
  useEffect(() => {
    if (!isStreaming) return

    const interval = setInterval(() => {
      const paths = ['/api/v1/users/profile', '/api/v1/orders', '/api/v1/embeddings', '/api/v1/auth/login', '/api/v1/payments/charge']
      const isBlocked = Math.random() < 0.15
      const isBreaker = !isBlocked && Math.random() < 0.05
      const p = paths[Math.floor(Math.random() * paths.length)]
      const m = p.includes('login') || p.includes('charge') || p.includes('embeddings') ? 'POST' : 'GET'

      const newEvent: TrafficEvent = {
        id: 'evt-' + Date.now(),
        timestamp: new Date().toISOString().substring(11, 23),
        method: m,
        path: p,
        clientIp: `192.168.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 254)}`,
        apiKey: `rs_live_${Math.random().toString(36).substring(7)}`,
        algorithm: p.includes('login') ? 'Fixed Window' : p.includes('charge') ? 'Sliding Window Log' : 'Token Bucket',
        quotaUsed: isBlocked ? '100/100' : `${Math.floor(Math.random() * 80)}/100`,
        latencyMs: +(Math.random() * 2.2 + 0.3).toFixed(2),
        status: isBreaker ? 503 : isBlocked ? 429 : 200,
        reason: isBreaker ? 'Upstream circuit breaker active' : isBlocked ? 'Volumetric quota exhausted' : undefined,
        headers: {
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': isBlocked ? '0' : '24',
          'X-RateLimit-Reset': '30s'
        }
      }

      setEvents(prev => [newEvent, ...prev.slice(0, 49)])
    }, 1800)

    return () => clearInterval(interval)
  }, [isStreaming])

  const filteredEvents = events.filter(e => {
    if (filterStatus !== 'all' && e.status.toString() !== filterStatus) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return (
        e.path.toLowerCase().includes(q) ||
        e.clientIp.toLowerCase().includes(q) ||
        e.apiKey.toLowerCase().includes(q) ||
        e.algorithm.toLowerCase().includes(q)
      )
    }
    return true
  })

  return (
    <div className="space-y-4">
      {/* Top Stream Control Ribbon */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-surface-container-low rounded-xl border border-border shadow-sm">
        {/* Stream Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-surface-container-lowest px-3 py-1.5 rounded-lg border border-border font-mono text-xs">
            <span className="relative flex h-2 w-2">
              {isStreaming ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-outline"></span>
              )}
            </span>
            <span className="text-on-surface uppercase tracking-wider font-semibold">
              {isStreaming ? 'Stream Active: wss://gateway:8080/events' : 'Stream Paused'}
            </span>
          </div>
          <div className="hidden md:flex items-center gap-2 text-on-surface-variant font-mono text-xs">
            <span className="text-secondary font-bold">2,450</span>
            <span>events/sec</span>
            <span className="text-outline">|</span>
            <span className="text-outline">Buffer: 100% retained</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className={`btn ${
              isStreaming ? 'btn-secondary' : 'btn-primary'
            }`}
          >
            {isStreaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isStreaming ? 'Pause Stream' : 'Resume Stream'}</span>
          </button>
          <button
            onClick={() => setEvents([])}
            className="btn btn-secondary"
            title="Clear buffer"
          >
            <Trash2 className="w-3.5 h-3.5 text-outline" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-surface-container-low rounded-xl border border-border">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 bg-surface-container-lowest p-1 rounded-lg border border-border font-mono text-xs">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1 rounded transition-colors ${
              filterStatus === 'all'
                ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                : 'text-outline hover:text-on-surface'
            }`}
          >
            All Events ({events.length})
          </button>
          <button
            onClick={() => setFilterStatus('200')}
            className={`px-3 py-1 rounded transition-colors ${
              filterStatus === '200'
                ? 'bg-secondary/20 text-secondary font-semibold shadow-sm'
                : 'text-outline hover:text-on-surface'
            }`}
          >
            200 OK
          </button>
          <button
            onClick={() => setFilterStatus('429')}
            className={`px-3 py-1 rounded transition-colors ${
              filterStatus === '429'
                ? 'bg-error/20 text-error font-semibold shadow-sm'
                : 'text-outline hover:text-on-surface'
            }`}
          >
            429 Blocked
          </button>
          <button
            onClick={() => setFilterStatus('503')}
            className={`px-3 py-1 rounded transition-colors ${
              filterStatus === '503'
                ? 'bg-tertiary/20 text-tertiary font-semibold shadow-sm'
                : 'text-outline hover:text-on-surface'
            }`}
          >
            503 Circuit-Break
          </button>
        </div>

        {/* Live Filter Search Input */}
        <div className="relative flex items-center min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-outline" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filter endpoint, client IP, key..."
            className="input-field pl-8"
          />
        </div>
      </div>

      {/* High-Density Telemetry Stream Log Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-border text-outline uppercase text-[10px] tracking-wider select-none">
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Method</th>
                <th className="py-2.5 px-3">Path</th>
                <th className="py-2.5 px-3">Client IP & Key</th>
                <th className="py-2.5 px-3">Algorithm</th>
                <th className="py-2.5 px-3">Tokens / State</th>
                <th className="py-2.5 px-3">Latency</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredEvents.map(evt => (
                <tr
                  key={evt.id}
                  onClick={() => setSelectedEvent(evt)}
                  className={`hover:bg-surface-container/60 transition-colors cursor-pointer ${
                    selectedEvent?.id === evt.id ? 'bg-surface-container' : ''
                  }`}
                >
                  <td className="py-2 px-3 text-outline whitespace-nowrap">{evt.timestamp}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span
                      className={
                        evt.method === 'GET'
                          ? 'method-get'
                          : evt.method === 'POST'
                          ? 'method-post'
                          : 'method-put'
                      }
                    >
                      {evt.method}
                    </span>
                  </td>
                  <td className="py-2 px-3 font-semibold text-on-surface whitespace-nowrap">
                    {evt.path}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="text-on-surface">{evt.clientIp}</span>
                    <span className="text-outline text-[10px] ml-1.5">({evt.apiKey})</span>
                  </td>
                  <td className="py-2 px-3 text-on-surface-variant whitespace-nowrap">
                    {evt.algorithm}
                  </td>
                  <td className="py-2 px-3 text-on-surface whitespace-nowrap">{evt.quotaUsed}</td>
                  <td className="py-2 px-3 text-primary whitespace-nowrap">{evt.latencyMs}ms</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {evt.status === 200 && (
                      <span className="badge-emerald">200 OK</span>
                    )}
                    {evt.status === 429 && (
                      <span className="badge-rose">429 Throttled</span>
                    )}
                    {evt.status === 503 && (
                      <span className="badge-amber">503 Breaker</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right text-outline whitespace-nowrap">
                    <span className="material-symbols-outlined text-[16px] text-outline hover:text-primary">
                      chevron_right
                    </span>
                  </td>
                </tr>
              ))}
              {filteredEvents.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-outline font-sans text-xs">
                    No traffic events matching active filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Request Inspector Drawer */}
      {selectedEvent && (
        <div className="fixed inset-y-0 right-0 w-full max-w-md bg-surface-container-low border-l border-border shadow-2xl z-50 p-6 flex flex-col justify-between overflow-y-auto">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">troubleshoot</span>
                <h3 className="font-sans font-bold text-sm text-on-surface">Event Telemetry Inspector</h3>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-outline hover:text-on-surface p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 font-mono text-xs">
              <div className="bg-surface-container-lowest p-3 rounded-lg border border-border space-y-2">
                <div className="flex justify-between">
                  <span className="text-outline">Event ID:</span>
                  <span className="text-on-surface font-semibold">{selectedEvent.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Timestamp:</span>
                  <span className="text-on-surface">{selectedEvent.timestamp}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">HTTP Status:</span>
                  <span
                    className={
                      selectedEvent.status === 200
                        ? 'text-secondary font-bold'
                        : selectedEvent.status === 429
                        ? 'text-error font-bold'
                        : 'text-tertiary font-bold'
                    }
                  >
                    {selectedEvent.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-outline">Ingress Latency:</span>
                  <span className="text-primary font-bold">{selectedEvent.latencyMs} ms</span>
                </div>
              </div>

              {selectedEvent.reason && (
                <div className="bg-error/10 border border-error/20 p-3 rounded-lg text-error">
                  <div className="font-semibold mb-1">Mitigation Triggered:</div>
                  <div className="text-[11px] leading-relaxed">{selectedEvent.reason}</div>
                </div>
              )}

              <div>
                <span className="font-mono text-[10px] text-outline uppercase tracking-wider block mb-2 font-semibold">
                  Injected Rate-Limit Headers
                </span>
                <div className="bg-surface-container-lowest p-3 rounded-lg border border-border space-y-1.5 text-[11px]">
                  {Object.entries(selectedEvent.headers || {}).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-outline">{k}:</span>
                      <span className="text-primary font-semibold">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <span className="font-mono text-[10px] text-outline uppercase tracking-wider block mb-2 font-semibold">
                  Enforcement Parameters
                </span>
                <div className="bg-surface-container-lowest p-3 rounded-lg border border-border space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-outline">Algorithm:</span>
                    <span className="text-on-surface">{selectedEvent.algorithm}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-outline">Target Endpoint:</span>
                    <span className="text-on-surface">{selectedEvent.path}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-outline">Client IP:</span>
                    <span className="text-on-surface">{selectedEvent.clientIp}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-outline">Quota Remaining:</span>
                    <span className="text-secondary">{selectedEvent.quotaUsed}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border mt-6">
            <button
              onClick={() => setSelectedEvent(null)}
              className="btn btn-secondary w-full"
            >
              Close Inspector
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
