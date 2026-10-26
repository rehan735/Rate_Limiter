import React from 'react'
import {
  BookOpen,
  Cpu,
  Layers,
  Terminal
} from 'lucide-react'

export const DocsPage: React.FC = () => {
  return (
    <div className="space-y-6 pb-12 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 p-5 bg-surface-container-low rounded-xl border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs mb-1">
            <span className="text-primary uppercase tracking-widest font-semibold flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              Developer Documentation
            </span>
            <span className="text-outline">/</span>
            <span className="text-on-surface-variant">RFC & Architecture Reference</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-on-surface">
              Technical Architecture & Algorithm Manual
            </h1>
          </div>
        </div>
      </div>

      {/* Distributed Architecture */}
      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-bold text-on-surface tracking-wide uppercase flex items-center gap-2 font-sans">
          <Layers className="w-4 h-4 text-primary" />
          Distributed Rate Limiting Topology
        </h2>
        <p className="text-xs text-on-surface-variant leading-relaxed font-sans">
          RateShield evaluates global quotas atomically using custom Redis Lua scripts evaluated inside Redis single-threaded execution loops. The gateway data plane acts as an ultra-low latency reverse proxy with zero connection drops.
        </p>

        <div className="p-4 rounded-xl bg-surface-container-lowest border border-border font-mono text-xs text-on-surface overflow-x-auto">
          <pre className="leading-6">
{`Client Request
      │
      ▼
[Gateway Data Plane :8080] ──► [Redis Cluster: Atomic EVALSHA Lua]
      │
      ▼ (Allowed)
[Circuit Breaker / Load Balancer]
      │
      ├── Mock User Service (:9001)
      ├── Mock Order Service (:9002)
      └── Mock Payment Service (:9003)`}
          </pre>
        </div>
      </div>

      {/* Algorithms Comparison Matrix */}
      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-bold text-on-surface tracking-wide uppercase flex items-center gap-2 font-sans">
          <Cpu className="w-4 h-4 text-primary" />
          Mathematical Algorithms Comparison Matrix
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-border text-outline uppercase text-[10px] tracking-wider select-none">
                <th className="py-3 px-3">Algorithm</th>
                <th className="py-3 px-3">Complexity</th>
                <th className="py-3 px-3">Memory / Key</th>
                <th className="py-3 px-3">Burst Tolerance</th>
                <th className="py-3 px-3">Recommended Use Case</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              <tr className="hover:bg-surface-container/60 transition-colors">
                <td className="py-3 px-3 font-semibold text-primary">Token Bucket</td>
                <td className="py-3 px-3">O(1)</td>
                <td className="py-3 px-3 text-secondary">~64 bytes</td>
                <td className="py-3 px-3">Configurable B capacity</td>
                <td className="py-3 px-3 text-on-surface-variant font-sans">REST APIs with bursty user traffic</td>
              </tr>
              <tr className="hover:bg-surface-container/60 transition-colors">
                <td className="py-3 px-3 font-semibold text-secondary">Sliding Window Counter</td>
                <td className="py-3 px-3">O(1)</td>
                <td className="py-3 px-3 text-secondary">~128 bytes</td>
                <td className="py-3 px-3">Smooth weighted interpolation</td>
                <td className="py-3 px-3 text-on-surface-variant font-sans">Multi-tenant SaaS tier quotas</td>
              </tr>
              <tr className="hover:bg-surface-container/60 transition-colors">
                <td className="py-3 px-3 font-semibold text-tertiary">Sliding Window Log</td>
                <td className="py-3 px-3">O(log N + M)</td>
                <td className="py-3 px-3 text-error">O(Requests)</td>
                <td className="py-3 px-3">Strict millisecond cap</td>
                <td className="py-3 px-3 text-on-surface-variant font-sans">Payment charges & financial transactions</td>
              </tr>
              <tr className="hover:bg-surface-container/60 transition-colors">
                <td className="py-3 px-3 font-semibold text-on-surface">Fixed Window Counter</td>
                <td className="py-3 px-3">O(1)</td>
                <td className="py-3 px-3 text-secondary">~32 bytes</td>
                <td className="py-3 px-3">Step boundary flaws</td>
                <td className="py-3 px-3 text-on-surface-variant font-sans">Auth login & brute-force mitigation</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Response Headers Specification */}
      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-bold text-on-surface tracking-wide uppercase flex items-center gap-2 font-sans">
          <Terminal className="w-4 h-4 text-primary" />
          Standardized Rate Limit HTTP Headers
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-border text-outline uppercase text-[10px] tracking-wider select-none">
                <th className="py-3 px-3">HTTP Header</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              <tr className="hover:bg-surface-container/60 transition-colors">
                <td className="py-2.5 px-3 font-semibold text-primary">X-RateLimit-Limit</td>
                <td className="py-2.5 px-3 text-outline">Integer</td>
                <td className="py-2.5 px-3 text-on-surface font-sans">Total quota allowed in the configured window.</td>
              </tr>
              <tr className="hover:bg-surface-container/60 transition-colors">
                <td className="py-2.5 px-3 font-semibold text-secondary">X-RateLimit-Remaining</td>
                <td className="py-2.5 px-3 text-outline">Integer</td>
                <td className="py-2.5 px-3 text-on-surface font-sans">Remaining quota tokens available for the client.</td>
              </tr>
              <tr className="hover:bg-surface-container/60 transition-colors">
                <td className="py-2.5 px-3 font-semibold text-on-surface">X-RateLimit-Reset</td>
                <td className="py-2.5 px-3 text-outline">Integer (Seconds)</td>
                <td className="py-2.5 px-3 text-on-surface font-sans">Time in seconds until quota window resets.</td>
              </tr>
              <tr className="hover:bg-surface-container/60 transition-colors">
                <td className="py-2.5 px-3 font-semibold text-error">Retry-After</td>
                <td className="py-2.5 px-3 text-outline">Integer (Seconds)</td>
                <td className="py-2.5 px-3 text-on-surface font-sans">Present on 429 Too Many Requests; client must wait before retrying.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
