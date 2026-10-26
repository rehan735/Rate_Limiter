import React, { useState, useEffect } from 'react'
import {
  Zap,
  Copy,
  Check,
  Pause,
  Play,
  Download,
  X
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts'
import { apiService } from '../services/api'
import { SystemMetricsSummary, MetricsDataPoint } from '../types/api'
import { useTheme } from '../context/ThemeContext'

interface DashboardPageProps {
  onOpenSandbox: () => void
  refreshInterval?: number
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  onOpenSandbox,
  refreshInterval = 2000
}) => {
  const { theme } = useTheme()
  const [metrics, setMetrics] = useState<SystemMetricsSummary | null>(null)
  const [history, setHistory] = useState<MetricsDataPoint[]>([])
  const [timeRange, setTimeRange] = useState<'15m' | '1h' | '24h' | '7d'>('1h')
  const [isAutoRefresh, setIsAutoRefresh] = useState(true)
  const [showAlertBanner, setShowAlertBanner] = useState(true)
  const [copiedCurl, setCopiedCurl] = useState(false)
  const [backendOffline, setBackendOffline] = useState(false)

  // Quick sandbox mini-state
  const [sandboxTokens, setSandboxTokens] = useState(100)
  const [sandboxCapacity, setSandboxCapacity] = useState(100)
  const [sandboxExhausted, setSandboxExhausted] = useState(false)
  const [retryTimer, setRetryTimer] = useState(0)

  // Seed initial timeline and summary
  useEffect(() => {
    let isMounted = true

    const seedPoints: MetricsDataPoint[] = []
    const now = Date.now()
    for (let i = 20; i >= 1; i--) {
      const d = new Date(now - i * 3000)
      const t = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
      seedPoints.push({
        timestamp: t,
        allowed_rps: 0,
        blocked_rps: 0,
        latency_p50: 0,
        latency_p95: 0,
        latency_p99: 0,
      })
    }
    setHistory(seedPoints)

    const fetchSummary = async () => {
      try {
        const data = await apiService.getMetricsSummary()
        if (!isMounted) return
        setMetrics(data)
        setBackendOffline(false)

        const now = new Date()
        const timeLabel = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
        const total = (data.allowed_requests || 0) + (data.blocked_requests || 0)
        let allowedRps = 0
        let blockedRps = 0
        if (data.current_rps > 0) {
          if (total > 0) {
            allowedRps = Math.round(data.current_rps * (data.allowed_requests / total))
            blockedRps = Math.max(0, Math.round(data.current_rps) - allowedRps)
          } else {
            allowedRps = Math.round(data.current_rps)
          }
        }

        setHistory(prev => {
          const next = [
            ...prev,
            {
              timestamp: timeLabel,
              allowed_rps: allowedRps,
              blocked_rps: blockedRps,
              latency_p50: data.p50_latency_ms || 0,
              latency_p95: data.p95_latency_ms || 0,
              latency_p99: data.p99_latency_ms || 0,
            }
          ]
          return next.slice(-25)
        })
      } catch (err) {
        if (!isMounted) return
        setBackendOffline(true)
        console.error('Failed to fetch metrics', err)
      }
    }

    fetchSummary()
    if (refreshInterval > 0 && isAutoRefresh) {
      const timer = setInterval(fetchSummary, refreshInterval)
      return () => {
        isMounted = false
        clearInterval(timer)
      }
    }
  }, [refreshInterval, isAutoRefresh])

  // Mini-sandbox continuous token refill
  useEffect(() => {
    const refillInterval = setInterval(() => {
      setSandboxTokens(prev => {
        if (prev < sandboxCapacity) {
          const next = Math.min(sandboxCapacity, prev + 2)
          if (next > 0) setSandboxExhausted(false)
          return next
        }
        return prev
      })
    }, 200)

    return () => clearInterval(refillInterval)
  }, [sandboxCapacity])

  // Mini-sandbox actions
  const handleFireSingle = () => {
    if (sandboxTokens <= 0) {
      setSandboxExhausted(true)
      setRetryTimer(2.4)
      return
    }
    setSandboxTokens(prev => {
      const next = prev - 1
      if (next <= 0) {
        setSandboxExhausted(true)
        setRetryTimer(2.4)
      }
      return Math.max(0, next)
    })
  }

  const handleFireBurst = () => {
    if (sandboxTokens < 25) {
      setSandboxExhausted(true)
      setRetryTimer(3.8)
    }
    setSandboxTokens(prev => {
      const next = prev - 25
      if (next <= 0) {
        setSandboxExhausted(true)
        setRetryTimer(3.8)
      }
      return Math.max(0, next)
    })
  }

  const testCurlCommand =
    'curl -i http://localhost:8080/api/v1/users/profile -H "X-Tenant-ID: tenant-globex" -H "X-API-Key: rs_live_89f2test"'

  const copyTestCurl = () => {
    navigator.clipboard.writeText(testCurlCommand)
    setCopiedCurl(true)
    setTimeout(() => setCopiedCurl(false), 2000)
  }

  const topThrottled = [
    { key: 'ip:198.51.100.24', count: '14,230', route: '/api/v1/auth/login', algorithm: 'Fixed Window', reason: 'Auth brute-force threshold hit' },
    { key: 'tenant:tenant-globex', count: '8,410', route: '/api/v1/orders/*', algorithm: 'Token Bucket', reason: 'Bucket capacity exhausted' },
    { key: 'ip:203.0.113.88', count: '4,195', route: '/api/v1/users/*', algorithm: 'Sliding Window Counter', reason: 'Sub-minute quota cap exceeded' },
    { key: 'tenant:anon-unauth', count: '2,980', route: '/api/v1/payments/charge', algorithm: 'Sliding Window Log', reason: 'Strict sorted-set limit reached' },
  ]

  // Color tokens for chart
  const isDark = theme === 'dark'
  const chartCyan = isDark ? '#4cd7f6' : '#06b6d4'
  const chartRed = isDark ? '#ffb4ab' : '#ef4444'
  const gridColor = isDark ? '#31353e' : '#cbd5e1'

  return (
    <div className="space-y-6 pb-12">
      {/* Backend Offline Warning Banner */}
      {backendOffline && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center justify-between text-red-400 shadow-md">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
            </span>
            <div>
              <p className="font-semibold text-sm">Control Plane Backend Offline</p>
              <p className="text-xs text-red-300/80">Unable to reach the control plane service. Live metric feeds and management updates are currently unavailable.</p>
            </div>
          </div>
          <span className="text-xs font-mono bg-red-500/20 text-red-300 px-2 py-1 rounded border border-red-500/30">
            Retrying...
          </span>
        </div>
      )}

      {/* 1. Incident Alert Banner */}
      {showAlertBanner && (
        <div className="relative overflow-hidden bg-surface-container-high rounded-xl p-4 border border-border shadow-md">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-tertiary"></div>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pl-2">
            <div className="flex items-center gap-3 min-w-0">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-tertiary"></span>
              </span>
              <div className="flex flex-wrap items-center gap-2 text-on-surface text-xs font-sans">
                <span className="font-mono text-[10px] bg-tertiary/15 text-tertiary px-2 py-0.5 rounded font-semibold uppercase">
                  Mitigation Active
                </span>
                <span className="font-medium">
                  Spike detected from{' '}
                  <code className="font-mono text-primary bg-surface-container-lowest px-1.5 py-0.5 rounded border border-border">
                    ASN 16509 (AWS us-west-2)
                  </code>{' '}
                  on{' '}
                  <code className="font-mono text-secondary bg-surface-container-lowest px-1.5 py-0.5 rounded border border-border">
                    /v1/embeddings
                  </code>
                </span>
                <span className="hidden lg:inline text-outline">
                  — Automatically smoothed via Token Bucket policy (Refill: 250 rps).
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
              <button
                onClick={onOpenSandbox}
                className="btn btn-secondary text-xs font-mono"
              >
                <span>Inspect in Lab</span>
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </button>
              <button
                onClick={() => setShowAlertBanner(false)}
                className="text-outline hover:text-on-surface p-1 rounded transition-colors"
                title="Dismiss banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Dashboard Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-container-low p-3 rounded-xl border border-border">
        <div className="flex flex-wrap items-center gap-2">
          {/* Time range pills */}
          <div className="flex items-center bg-surface-container-lowest p-0.5 rounded-lg border border-border font-mono text-xs">
            {(['15m', '1h', '24h', '7d'] as const).map(tr => (
              <button
                key={tr}
                onClick={() => setTimeRange(tr)}
                className={`px-3 py-1 rounded transition-colors ${
                  timeRange === tr
                    ? 'bg-surface-container-high text-primary font-semibold shadow-sm'
                    : 'text-outline hover:text-on-surface'
                }`}
              >
                {tr}
              </button>
            ))}
          </div>

          {/* Active Filter Tags */}
          <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-border font-mono text-xs">
            <span className="text-[10px] text-outline uppercase font-semibold">Filters:</span>
            <span className="bg-surface-container text-on-surface-variant px-2 py-0.5 rounded flex items-center gap-1 border border-border">
              <span>cluster:</span>
              <span className="text-primary font-semibold">us-east-1</span>
            </span>
            <span className="bg-surface-container text-on-surface-variant px-2 py-0.5 rounded flex items-center gap-1 border border-border">
              <span>tier:</span>
              <span className="text-secondary font-semibold">all</span>
            </span>
          </div>
        </div>

        {/* Auto Refresh & Export */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-surface-container-lowest px-3 py-1 rounded-lg border border-border font-mono text-xs">
            <span className="relative flex h-2 w-2">
              {isAutoRefresh ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-outline"></span>
              )}
            </span>
            <span className="text-on-surface font-medium">Auto-refresh (2s)</span>
            <button
              onClick={() => setIsAutoRefresh(!isAutoRefresh)}
              className="text-primary hover:text-primary-fixed-dim"
              title={isAutoRefresh ? 'Pause polling' : 'Resume polling'}
            >
              {isAutoRefresh ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
          </div>

          <button className="btn btn-secondary" title="Export current telemetry snapshot">
            <Download className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Export</span>
          </button>
        </div>
      </div>

      {/* 3. Telemetry 4-Card Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: Ingress Requests */}
        <div className="card-telemetry relative overflow-hidden group">
          <div className="flex items-center justify-between text-outline mb-1 font-mono text-xs">
            <span className="text-[10px] uppercase font-semibold tracking-wider">Total Ingress Volume</span>
            <span className="text-secondary bg-secondary/10 px-1.5 py-0.5 rounded font-semibold text-[11px]">
              +12.4%
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-2 font-mono">
            <span className="text-3xl font-bold text-on-surface tracking-tight">
              {metrics && metrics.total_requests > 0
                ? (metrics.total_requests / 1000000).toFixed(2) + 'M'
                : '48.24M'}
            </span>
            <span className="text-xs text-outline">/ 60m</span>
          </div>

          {/* Mini Sparkline */}
          <div className="h-10 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartCyan} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={chartCyan} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="allowed_rps" stroke={chartCyan} strokeWidth={2} fill="url(#sparkGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-between font-mono text-[10px] text-outline mt-1 pt-1 border-t border-border/50">
            <span>Avg: 13,400 rps</span>
            <span>Peak: 22,891 rps</span>
          </div>
        </div>

        {/* KPI 2: Mitigation Ratio */}
        <div className="card-telemetry flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-outline mb-1 font-mono text-xs">
              <span className="text-[10px] uppercase font-semibold tracking-wider">Mitigation Ratio</span>
              <span className="text-error bg-error/10 px-1.5 py-0.5 rounded font-semibold text-[11px]">
                1.4% 429s
              </span>
            </div>
            <div className="flex items-baseline gap-2 mb-2 font-mono">
              <span className="text-3xl font-bold text-secondary tracking-tight">98.6%</span>
              <span className="text-xs text-on-surface-variant font-medium">Allowed</span>
            </div>
            {/* Dual stacked progress bar */}
            <div className="w-full h-2.5 bg-surface-container-highest rounded-full overflow-hidden flex gap-0.5 p-0.5 mb-2">
              <div className="h-full bg-secondary rounded-l-full transition-all" style={{ width: '98.6%' }}></div>
              <div className="h-full bg-error rounded-r-full transition-all" style={{ width: '1.4%' }}></div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50 font-mono text-xs text-on-surface-variant">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-secondary"></span>
              <span>47.56M OK</span>
            </div>
            <div className="flex items-center gap-1.5 justify-end">
              <span className="w-2 h-2 rounded-full bg-error"></span>
              <span className="text-error font-medium">681.4k Drop</span>
            </div>
          </div>
        </div>

        {/* KPI 3: P99 Limiter Latency */}
        <div className="card-telemetry">
          <div className="flex items-center justify-between text-outline mb-1 font-mono text-xs">
            <span className="text-[10px] uppercase font-semibold tracking-wider">P99 Limiter Latency</span>
            <span className="text-primary bg-primary/10 px-1.5 py-0.5 rounded font-semibold text-[11px]">
              Sub-2ms SLA
            </span>
          </div>
          <div className="flex items-baseline gap-1.5 mb-1 font-mono">
            <span className="text-3xl font-bold text-primary tracking-tight">1.82</span>
            <span className="text-sm text-on-surface font-semibold">ms</span>
          </div>
          <p className="font-sans text-xs text-outline mb-2.5 leading-relaxed">
            Redis Cluster atomic evalsha overhead across distributed shard nodes.
          </p>
          <div className="flex items-center justify-between font-mono text-xs bg-surface-container-lowest p-2 rounded-lg border border-border text-on-surface">
            <span>P50: <span className="text-secondary font-semibold">0.41ms</span></span>
            <span>P95: <span className="text-primary font-semibold">1.15ms</span></span>
            <span>P99.9: <span className="text-tertiary font-semibold">3.88ms</span></span>
          </div>
        </div>

        {/* KPI 4: Active Client Buckets */}
        <div className="card-telemetry">
          <div className="flex items-center justify-between text-outline mb-1 font-mono text-xs">
            <span className="text-[10px] uppercase font-semibold tracking-wider">Active Client Buckets</span>
            <span className="flex items-center gap-1 text-secondary text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
              Synced
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-2 font-mono">
            <span className="text-3xl font-bold text-on-surface tracking-tight">142,890</span>
            <span className="text-xs text-outline">keys</span>
          </div>
          <div className="flex items-center justify-between font-mono text-xs mb-1.5 text-on-surface-variant">
            <span>Memory Consumption</span>
            <span className="text-primary font-semibold">1.24 GB / 8.00 GB</span>
          </div>
          <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden mb-2">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: '15.5%' }}></div>
          </div>
          <div className="flex items-center justify-between font-mono text-[10px] text-outline pt-1 border-t border-border/50">
            <span>TTL Avg: 60.0s</span>
            <span>Evictions/s: 0</span>
          </div>
        </div>
      </div>

      {/* 4. Main Analytics Row: Large Volume Chart & Interactive Token Bucket Sandbox */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Large Throughput Chart (8 cols) */}
        <div className="lg:col-span-8 card p-5 flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-sans text-base font-semibold text-on-surface">
                  Ingress Throughput & Throttle Dynamics
                </h3>
                <span className="material-symbols-outlined text-outline text-[16px]">info</span>
              </div>
              <p className="font-mono text-xs text-outline mt-0.5">
                Aggregated across gateway ingress nodes (sample: 2000ms)
              </p>
            </div>
            <div className="flex items-center gap-4 font-mono text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-primary"></span>
                <span className="text-on-surface-variant">200 OK</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-error"></span>
                <span className="text-on-surface-variant">429 Blocked</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded bg-tertiary"></span>
                <span className="text-on-surface-variant">503 Breaker</span>
              </div>
            </div>
          </div>

          {/* Area Chart */}
          <div className="h-64 w-full bg-surface-container-lowest rounded-xl p-2 border border-border">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAllowed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartCyan} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={chartCyan} stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartRed} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={chartRed} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} strokeOpacity={0.6} />
                <XAxis dataKey="timestamp" stroke="#869397" fontSize={10} tickLine={false} />
                <YAxis stroke="#869397" fontSize={10} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: isDark ? '#181c24' : '#ffffff',
                    borderColor: gridColor,
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontFamily: 'JetBrains Mono',
                    color: isDark ? '#dfe2ee' : '#09090b',
                  }}
                />
                <Area type="monotone" dataKey="allowed_rps" name="200 OK" stroke={chartCyan} strokeWidth={2} fill="url(#colorAllowed)" />
                <Area type="monotone" dataKey="blocked_rps" name="429 Blocked" stroke={chartRed} strokeWidth={2} fill="url(#colorBlocked)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Quick Metrics Bar below chart */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-border font-mono text-xs">
            <div className="bg-surface-container p-2 rounded-lg border border-border">
              <span className="text-[10px] text-outline uppercase block font-semibold">Threshold Limit</span>
              <span className="text-on-surface font-bold text-sm">20,000 req/s</span>
            </div>
            <div className="bg-surface-container p-2 rounded-lg border border-border">
              <span className="text-[10px] text-outline uppercase block font-semibold">Max Burst Hit</span>
              <span className="text-error font-bold text-sm">22,830 req/s</span>
            </div>
            <div className="bg-surface-container p-2 rounded-lg border border-border">
              <span className="text-[10px] text-outline uppercase block font-semibold">Current Velocity</span>
              <span className="text-secondary font-bold text-sm">14,280 req/s</span>
            </div>
            <div className="bg-surface-container p-2 rounded-lg border border-border">
              <span className="text-[10px] text-outline uppercase block font-semibold">Redis Cluster</span>
              <span className="text-primary font-bold text-sm">12/12 Nodes OK</span>
            </div>
          </div>
        </div>

        {/* Interactive Quick Token Bucket Sandbox (4 cols) */}
        <div className="lg:col-span-4 card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">hourglass_empty</span>
                <h3 className="font-sans text-base font-semibold text-on-surface">Token Sandbox</h3>
              </div>
              <span className="font-mono text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded font-semibold border border-primary/20">
                LIVE LAB
              </span>
            </div>
            <p className="font-sans text-xs text-outline mb-4">
              Execute live requests against this simulated Redis token-bucket to trigger instant 429 mitigation.
            </p>

            {/* Bucket Capacity Visualization */}
            <div className="bg-surface-container-lowest p-4 rounded-xl border border-border mb-4">
              <div className="flex items-center justify-between mb-2 font-mono text-xs">
                <span className="text-outline">Bucket State:</span>
                <span className="font-bold text-on-surface">
                  <span className="text-primary text-base">{sandboxTokens}</span> / {sandboxCapacity} tokens
                </span>
              </div>

              {/* Progress fill bar */}
              <div className="w-full bg-surface-container h-8 rounded-lg p-1 flex gap-0.5 overflow-hidden mb-2 border border-border">
                <div
                  className={`h-full rounded transition-all duration-150 flex items-center justify-end pr-1.5 ${
                    sandboxTokens > 20 ? 'bg-primary' : 'bg-error'
                  }`}
                  style={{ width: `${(sandboxTokens / sandboxCapacity) * 100}%` }}
                >
                  <span className="w-1.5 h-1.5 bg-on-primary rounded-full animate-ping"></span>
                </div>
              </div>

              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="flex items-center gap-1 text-secondary">
                  <span className="material-symbols-outlined text-[13px]">autorenew</span>
                  Refill: +10 tokens/s
                </span>
                <span className={`font-semibold ${sandboxExhausted ? 'text-error' : 'text-secondary'}`}>
                  STATE: {sandboxExhausted ? 'EXHAUSTED' : 'NOMINAL'}
                </span>
              </div>

              {sandboxExhausted && (
                <div className="mt-3 p-2 bg-error/15 border border-error/30 rounded font-mono text-xs text-error flex items-center justify-between animate-shake">
                  <span className="flex items-center gap-1.5 font-bold">
                    <span className="material-symbols-outlined text-[16px]">block</span>
                    429 Too Many Requests
                  </span>
                  <span className="font-bold">Retry-After: {retryTimer}s</span>
                </div>
              )}
            </div>

            {/* Sandbox Slider Control */}
            <div className="space-y-3 mb-4 font-mono text-xs">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-outline">Burst Limit:</span>
                  <span className="text-on-surface font-semibold">{sandboxCapacity} req</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="200"
                  value={sandboxCapacity}
                  onChange={e => {
                    const val = parseInt(e.target.value, 10)
                    setSandboxCapacity(val)
                    if (sandboxTokens > val) setSandboxTokens(val)
                  }}
                  className="w-full h-1.5 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary"
                />
              </div>
            </div>
          </div>

          {/* Trigger Actions */}
          <div className="flex flex-col gap-2">
            <button
              onClick={handleFireSingle}
              className="btn-primary w-full py-2.5 font-sans font-semibold text-xs flex items-center justify-center gap-1.5"
            >
              <Zap className="w-4 h-4 fill-current" />
              <span>Fire Test Request (-1)</span>
            </button>
            <button
              onClick={handleFireBurst}
              className="btn-secondary w-full py-2 font-mono text-xs flex items-center justify-center gap-1.5"
            >
              <span>Burst Test (Spike 25 requests)</span>
            </button>
          </div>
        </div>
      </div>

      {/* 5. Real-time Active Policies & Quota Rules Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4 flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
            <span className="material-symbols-outlined text-[24px]">verified_user</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-sans font-semibold text-sm text-on-surface">Tier 1: Free Developer</span>
            <span className="font-mono text-xs text-outline mt-0.5">Algorithm: Token Bucket (Strict)</span>
            <div className="flex items-center gap-2 mt-2 font-mono text-xs">
              <span className="badge-cyan">60 req/min</span>
              <span className="text-outline text-[11px]">Burst: 10</span>
              <span className="text-secondary text-[11px] ml-auto">94,120 clients</span>
            </div>
          </div>
        </div>

        <div className="card p-4 flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-secondary/10 text-secondary border border-secondary/20">
            <span className="material-symbols-outlined text-[24px]">corporate_fare</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-sans font-semibold text-sm text-on-surface">Tier 2: Enterprise Pro</span>
            <span className="font-mono text-xs text-outline mt-0.5">Algorithm: Sliding Window Counter</span>
            <div className="flex items-center gap-2 mt-2 font-mono text-xs">
              <span className="badge-emerald">5,000 req/s</span>
              <span className="text-outline text-[11px]">Burst: 800</span>
              <span className="text-secondary text-[11px] ml-auto">1,480 clients</span>
            </div>
          </div>
        </div>

        <div className="card p-4 flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-tertiary/10 text-tertiary border border-tertiary/20">
            <span className="material-symbols-outlined text-[24px]">water_drop</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-sans font-semibold text-sm text-on-surface">AI Inference Ingestion</span>
            <span className="font-mono text-xs text-outline mt-0.5">Algorithm: Leaky Bucket (Queue Smoothed)</span>
            <div className="flex items-center gap-2 mt-2 font-mono text-xs">
              <span className="badge-amber">250 tokens/s</span>
              <span className="text-outline text-[11px]">Queue: 500</span>
              <span className="text-secondary text-[11px] ml-auto">412 clients</span>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Top Throttled Entities & Endpoints Table */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-sans text-base font-semibold text-on-surface">Top Throttled Entities</h3>
              <span className="badge-rose text-[10px]">Live 429 Violations</span>
            </div>
            <p className="font-mono text-xs text-outline mt-0.5">
              High-velocity clients triggering automated rate protection rules
            </p>
          </div>
          <button
            onClick={copyTestCurl}
            className="btn btn-secondary font-mono text-xs"
          >
            {copiedCurl ? <Check className="w-3.5 h-3.5 text-secondary" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedCurl ? 'cURL Copied' : 'Copy Test cURL'}</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-border text-outline uppercase text-[10px] tracking-wider select-none">
                <th className="py-2.5 px-3">Client Identifier</th>
                <th className="py-2.5 px-3">Target Endpoint</th>
                <th className="py-2.5 px-3">Limiting Algorithm</th>
                <th className="py-2.5 px-3">429 Count</th>
                <th className="py-2.5 px-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {topThrottled.map((item, idx) => (
                <tr key={idx} className="hover:bg-surface-container/60 transition-colors">
                  <td className="py-2.5 px-3 font-semibold text-primary">{item.key}</td>
                  <td className="py-2.5 px-3 text-on-surface">{item.route}</td>
                  <td className="py-2.5 px-3 text-on-surface-variant">{item.algorithm}</td>
                  <td className="py-2.5 px-3 text-error font-bold">{item.count}</td>
                  <td className="py-2.5 px-3 text-outline text-[11px]">{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
