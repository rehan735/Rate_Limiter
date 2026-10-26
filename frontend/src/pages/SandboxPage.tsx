import React, { useState, useEffect } from 'react'
import {
  Zap,
  RotateCcw,
  Sliders,
  Play,
  Pause,
  Terminal
} from 'lucide-react'
import { SandboxResponseResult, Algorithm } from '../types/api'

export const SandboxPage: React.FC = () => {
  const [selectedAlgo, setSelectedAlgo] = useState<Algorithm>('token_bucket')

  // Algorithm Parameters
  const [capacity, setCapacity] = useState<number>(60)
  const [refillRate, setRefillRate] = useState<number>(10)
  const [windowSeconds, setWindowSeconds] = useState<number>(60)
  const [requestCost] = useState<number>(1)

  // Simulation State
  const [currentTokens, setCurrentTokens] = useState<number>(60)
  const [isSimulatingTraffic, setIsSimulatingTraffic] = useState<boolean>(false)
  const [trafficRate, setTrafficRate] = useState<number>(12) // req/sec
  const [logs, setLogs] = useState<SandboxResponseResult[]>([])
  const [totalSent, setTotalSent] = useState<number>(0)
  const [totalAllowed, setTotalAllowed] = useState<number>(0)
  const [totalThrottled, setTotalThrottled] = useState<number>(0)

  // Token refill interval
  useEffect(() => {
    if (selectedAlgo !== 'token_bucket') return

    const timer = setInterval(() => {
      setCurrentTokens(prev => {
        if (prev < capacity) {
          const next = Math.min(capacity, prev + refillRate / 10)
          return +next.toFixed(1)
        }
        return prev
      })
    }, 100)

    return () => clearInterval(timer)
  }, [capacity, refillRate, selectedAlgo])

  // Synthetic traffic generator
  useEffect(() => {
    if (!isSimulatingTraffic) return

    const intervalMs = Math.max(50, Math.floor(1000 / trafficRate))
    const generator = setInterval(() => {
      dispatchRequest(requestCost)
    }, intervalMs)

    return () => clearInterval(generator)
  }, [isSimulatingTraffic, trafficRate, requestCost, currentTokens, capacity])


  const dispatchRequest = (cost: number = 1) => {
    const now = new Date()
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`

    let allowed = false
    let remaining = 0
    let retryAfter = 0

    if (selectedAlgo === 'token_bucket') {
      if (currentTokens >= cost) {
        allowed = true
        remaining = Math.floor(currentTokens - cost)
        setCurrentTokens(prev => Math.max(0, +(prev - cost).toFixed(1)))
      } else {
        allowed = false
        remaining = 0
        retryAfter = +(cost / refillRate).toFixed(2)
      }
    } else if (selectedAlgo === 'fixed_window' || selectedAlgo === 'sliding_window') {
      if (currentTokens >= cost) {
        allowed = true
        remaining = Math.floor(currentTokens - cost)
        setCurrentTokens(prev => Math.max(0, prev - cost))
      } else {
        allowed = false
        remaining = 0
        retryAfter = windowSeconds
      }
    } else {
      // Sliding window log
      if (currentTokens >= cost) {
        allowed = true
        remaining = Math.floor(currentTokens - cost)
        setCurrentTokens(prev => Math.max(0, prev - cost))
      } else {
        allowed = false
        remaining = 0
        retryAfter = 1.5
      }
    }

    setTotalSent(prev => prev + 1)
    if (allowed) setTotalAllowed(prev => prev + 1)
    else setTotalThrottled(prev => prev + 1)

    const logEntry: SandboxResponseResult = {
      request_index: Date.now(),
      timestamp: timeStr,
      status_code: allowed ? 200 : 429,
      allowed,
      remaining: remaining,
      limit: capacity,
      reset_in_seconds: retryAfter,
      latency_ms: +(Math.random() * 1.5 + 0.3).toFixed(2),
    }

    setLogs(prev => [logEntry, ...prev.slice(0, 39)])
  }

  const handleBurst = (count: number = 20) => {
    for (let i = 0; i < count; i++) {
      setTimeout(() => dispatchRequest(requestCost), i * 15)
    }
  }

  const handleReset = () => {
    setCurrentTokens(capacity)
    setLogs([])
    setTotalSent(0)
    setTotalAllowed(0)
    setTotalThrottled(0)
    setIsSimulatingTraffic(false)
  }

  const applyPreset = (preset: 'normal' | 'flash' | 'brute' | 'micro') => {
    if (preset === 'normal') {
      setSelectedAlgo('token_bucket')
      setCapacity(60)
      setRefillRate(10)
      setTrafficRate(8)
      setCurrentTokens(60)
    } else if (preset === 'flash') {
      setSelectedAlgo('token_bucket')
      setCapacity(40)
      setRefillRate(5)
      setTrafficRate(25)
      setCurrentTokens(40)
    } else if (preset === 'brute') {
      setSelectedAlgo('fixed_window')
      setCapacity(10)
      setWindowSeconds(60)
      setTrafficRate(15)
      setCurrentTokens(10)
    } else if (preset === 'micro') {
      setSelectedAlgo('sliding_window_log')
      setCapacity(15)
      setRefillRate(2)
      setTrafficRate(12)
      setCurrentTokens(15)
    }
  }

  // Generate tokens matrix visually (up to 60 blocks)
  const tokenBlocks = Array.from({ length: Math.min(60, capacity) }, (_, i) => {
    const isFilled = i < Math.round((currentTokens / capacity) * Math.min(60, capacity))
    return isFilled
  })

  return (
    <div className="space-y-6 pb-12">
      {/* Mission Header */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 p-5 bg-surface-container-low rounded-xl border border-border shadow-sm">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 mb-2 font-mono text-xs">
            <span className="bg-primary/10 text-primary px-2.5 py-0.5 rounded font-semibold border border-primary/20 uppercase tracking-wider">
              Algorithm Sandbox
            </span>
            <span className="text-outline">•</span>
            <span className="text-secondary flex items-center gap-1 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span> 60 FPS Reactive Engine
            </span>
          </div>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-on-surface">
            Live Algorithm Lab
          </h1>
          <p className="font-sans text-xs text-on-surface-variant mt-1 leading-relaxed">
            Model, stress-test, and inspect rate-limiting algorithms against synthetic Poisson bursts, micro-spikes, and sustained volumetric traffic prior to cluster deployment.
          </p>
        </div>

        {/* Algorithm Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 bg-surface-container-lowest p-1.5 rounded-xl border border-border font-mono text-xs">
          {[
            { id: 'token_bucket', label: 'Token Bucket' },
            { id: 'sliding_window', label: 'Sliding Counter' },
            { id: 'sliding_window_log', label: 'Sliding Log' },
            { id: 'fixed_window', label: 'Fixed Window' },
          ].map(algo => (
            <button
              key={algo.id}
              onClick={() => {
                setSelectedAlgo(algo.id as Algorithm)
                setCurrentTokens(capacity)
              }}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                selectedAlgo === algo.id
                  ? 'bg-primary-container text-on-primary-container font-semibold shadow-sm'
                  : 'text-outline hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              {algo.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mathematical Model Box */}
      <div className="p-4 bg-surface-container-low rounded-xl border border-border font-mono text-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-outline uppercase font-semibold tracking-wider">
            Active Mathematical Formulation
          </span>
          <span className="text-primary font-semibold">
            {selectedAlgo === 'token_bucket' && 'Continuous Refill O(1)'}
            {selectedAlgo === 'sliding_window' && 'Weighted Epoch Interpolation O(1)'}
            {selectedAlgo === 'sliding_window_log' && 'Sorted Set Cardinality O(log N)'}
            {selectedAlgo === 'fixed_window' && 'Atomic Counter with TTL O(1)'}
          </span>
        </div>
        <div className="bg-surface-container-lowest p-3 rounded-lg border border-border text-on-surface flex items-center justify-between overflow-x-auto">
          <code>
            {selectedAlgo === 'token_bucket' &&
              'Tokens_now = min(B, Tokens_prev + (t_now - t_prev) * refill_rate) - cost'}
            {selectedAlgo === 'sliding_window' &&
              'Estimated_Count = Count_prev * (1 - t_elapsed / Window) + Count_curr <= Limit'}
            {selectedAlgo === 'sliding_window_log' &&
              'Active_Set = | { t ∈ ZSET | t > t_now - Window } | + cost <= Limit'}
            {selectedAlgo === 'fixed_window' &&
              'Bucket_ID = floor(t_now / Window); INCRBY(Key:Bucket_ID, cost) <= Limit'}
          </code>
          <span className="text-secondary font-semibold ml-4 shrink-0">Deterministic Redis Lua</span>
        </div>
      </div>

      {/* Main Sandbox Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Capacity Visualizer & Controls (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Reactive Token Matrix Card */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3 font-mono text-xs">
              <span className="text-outline uppercase tracking-wider font-semibold">
                Available Capacity Gauge
              </span>
              <span className="font-bold text-on-surface">
                <span className="text-primary text-xl font-bold">{Math.floor(currentTokens)}</span> / {capacity}{' '}
                tokens
              </span>
            </div>

            {/* Token Block Matrix */}
            <div className="bg-surface-container-lowest p-4 rounded-xl border border-border mb-4">
              <div className="grid grid-cols-12 gap-1.5">
                {tokenBlocks.map((filled, i) => (
                  <div
                    key={i}
                    className={`h-5 rounded-xs transition-all duration-150 ${
                      filled
                        ? 'bg-primary shadow-[0_0_8px_rgba(6,182,212,0.4)]'
                        : 'bg-surface-container border border-border/40 opacity-30'
                    }`}
                  ></div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-3 font-mono text-xs text-outline pt-2 border-t border-border/60">
                <span className="text-secondary flex items-center gap-1 font-semibold">
                  <span className="material-symbols-outlined text-[14px]">autorenew</span>
                  Refill: +{refillRate} tokens/sec
                </span>
                <span>
                  Filled:{' '}
                  <span className="text-primary font-semibold">
                    {Math.round((currentTokens / capacity) * 100)}%
                  </span>
                </span>
              </div>
            </div>

            {/* Preset Scenarios */}
            <div className="flex flex-wrap items-center gap-2 mb-4 font-mono text-xs">
              <span className="text-outline uppercase text-[10px] font-semibold">Load Presets:</span>
              <button
                onClick={() => applyPreset('normal')}
                className="btn btn-secondary px-2.5 py-1 text-xs"
              >
                Nominal Flow
              </button>
              <button
                onClick={() => applyPreset('flash')}
                className="btn btn-secondary px-2.5 py-1 text-xs text-tertiary"
              >
                Flash Burst (25 rps)
              </button>
              <button
                onClick={() => applyPreset('brute')}
                className="btn btn-secondary px-2.5 py-1 text-xs text-error"
              >
                Brute Force Test
              </button>
              <button
                onClick={() => applyPreset('micro')}
                className="btn btn-secondary px-2.5 py-1 text-xs"
              >
                Micro-Spike
              </button>
            </div>

            {/* Manual Trigger Buttons */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => dispatchRequest(requestCost)}
                className="btn-primary py-2.5 font-sans font-semibold text-xs flex items-center justify-center gap-1.5"
              >
                <Zap className="w-4 h-4 fill-current" />
                <span>Fire Single (-{requestCost})</span>
              </button>
              <button
                onClick={() => handleBurst(20)}
                className="btn-secondary py-2.5 font-mono text-xs flex items-center justify-center gap-1.5 text-tertiary"
              >
                <span>Burst (+20 req)</span>
              </button>
              <button
                onClick={handleReset}
                className="btn-secondary py-2.5 font-mono text-xs flex items-center justify-center gap-1.5 text-outline hover:text-on-surface"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Interactive Parameters Configuration */}
          <div className="card p-5 font-mono text-xs space-y-4">
            <h3 className="font-sans font-semibold text-sm text-on-surface flex items-center gap-2">
              <Sliders className="w-4 h-4 text-primary" />
              <span>Policy Tuners & Rate Constants</span>
            </h3>

            {/* Capacity Slider */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-outline">Bucket Capacity / Limit (B):</span>
                <span className="text-on-surface font-semibold">{capacity} tokens</span>
              </div>
              <input
                type="range"
                min="10"
                max="120"
                value={capacity}
                onChange={e => {
                  const val = parseInt(e.target.value, 10)
                  setCapacity(val)
                  if (currentTokens > val) setCurrentTokens(val)
                }}
                className="w-full h-1.5 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            {/* Refill Rate Slider */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-outline">Refill Rate (r tokens/sec):</span>
                <span className="text-on-surface font-semibold">{refillRate} tokens/s</span>
              </div>
              <input
                type="range"
                min="1"
                max="50"
                value={refillRate}
                onChange={e => setRefillRate(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            {/* Traffic Generator Toggle */}
            <div className="pt-2 border-t border-border flex items-center justify-between">
              <div>
                <span className="font-semibold text-on-surface block">Synthetic Traffic Stream</span>
                <span className="text-outline text-[11px]">Continuously injects request load</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-primary">{trafficRate} req/s</span>
                <button
                  onClick={() => setIsSimulatingTraffic(!isSimulatingTraffic)}
                  className={`btn ${isSimulatingTraffic ? 'btn-danger' : 'btn-primary'}`}
                >
                  {isSimulatingTraffic ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{isSimulatingTraffic ? 'Stop Stream' : 'Start Stream'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Telemetry & Log Stream (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Counters Card */}
          <div className="grid grid-cols-3 gap-3 font-mono text-xs">
            <div className="card p-3 text-center">
              <span className="text-[10px] text-outline uppercase font-semibold block">Total Ingress</span>
              <span className="text-lg font-bold text-on-surface mt-1 block">{totalSent}</span>
            </div>
            <div className="card p-3 text-center">
              <span className="text-[10px] text-outline uppercase font-semibold block">Passed (200)</span>
              <span className="text-lg font-bold text-secondary mt-1 block">{totalAllowed}</span>
            </div>
            <div className="card p-3 text-center">
              <span className="text-[10px] text-outline uppercase font-semibold block">Throttled (429)</span>
              <span className="text-lg font-bold text-error mt-1 block">{totalThrottled}</span>
            </div>
          </div>

          {/* Real-time Response Trace Stream */}
          <div className="card p-4 flex flex-col h-[520px]">
            <div className="flex items-center justify-between pb-3 border-b border-border mb-3 font-mono text-xs">
              <span className="font-sans font-semibold text-on-surface flex items-center gap-2">
                <Terminal className="w-4 h-4 text-primary" />
                <span>Live Response Stream</span>
              </span>
              <span className="text-outline text-[10px]">Buffer: {logs.length} / 40</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-xs">
              {logs.map(log => (
                <div
                  key={log.request_index}
                  className={`p-2.5 rounded-lg border flex items-center justify-between ${
                    log.allowed
                      ? 'bg-secondary/10 border-secondary/20 text-on-surface'
                      : 'bg-error/10 border-error/20 text-on-surface'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        log.allowed ? 'bg-secondary text-on-secondary' : 'bg-error text-on-error'
                      }`}
                    >
                      {log.status_code}
                    </span>
                    <span className="text-outline text-[11px]">{log.timestamp}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="text-outline">
                      Rem: <span className="text-on-surface font-semibold">{log.remaining}</span>
                    </span>
                    <span className="text-primary font-semibold">{log.latency_ms}ms</span>
                    {!log.allowed && (
                      <span className="text-error font-bold">R-After: {log.reset_in_seconds}s</span>
                    )}
                  </div>
                </div>
              ))}
              {logs.length === 0 && (
                <div className="h-full flex items-center justify-center text-outline font-sans text-xs">
                  Fire a test request or launch synthetic stream to inspect live evaluations.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
