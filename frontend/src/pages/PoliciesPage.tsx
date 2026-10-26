import React, { useState, useEffect } from 'react'
import {
  Plus,
  Trash2,
  Edit2,
  Search,
  X
} from 'lucide-react'
import { apiService } from '../services/api'
import { RateLimitPolicy, Algorithm, FailureMode } from '../types/api'

export const PoliciesPage: React.FC = () => {
  const [policies, setPolicies] = useState<RateLimitPolicy[]>([])
  const [filteredPolicies, setFilteredPolicies] = useState<RateLimitPolicy[]>([])
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [editingPolicy, setEditingPolicy] = useState<RateLimitPolicy | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [algorithmFilter, setAlgorithmFilter] = useState<string>('all')

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [algorithm, setAlgorithm] = useState<Algorithm>('token_bucket')
  const [limit, setLimit] = useState<number>(100)
  const [windowSeconds, setWindowSeconds] = useState<number>(60)
  const [burstCapacity, setBurstCapacity] = useState<number>(20)
  const [refillRate, setRefillRate] = useState<number>(1.66)
  const [requestCost, setRequestCost] = useState<number>(1)
  const [failureMode, setFailureMode] = useState<FailureMode>('fail_open')
  const [dimensions, setDimensions] = useState<string>('tenant_id,route_id')

  const fetchPolicies = async () => {
    const data = await apiService.getPolicies()
    setPolicies(data)
  }

  useEffect(() => {
    fetchPolicies()
  }, [])

  useEffect(() => {
    let result = policies
    if (searchTerm) {
      result = result.filter(
        p =>
          p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase()))
      )
    }
    if (algorithmFilter !== 'all') {
      result = result.filter(p => p.algorithm === algorithmFilter)
    }
    setFilteredPolicies(result)
  }, [policies, searchTerm, algorithmFilter])

  const handleOpenCreate = () => {
    setEditingPolicy(null)
    setName('')
    setDescription('')
    setAlgorithm('token_bucket')
    setLimit(100)
    setWindowSeconds(60)
    setBurstCapacity(20)
    setRefillRate(1.66)
    setRequestCost(1)
    setFailureMode('fail_open')
    setDimensions('tenant_id,route_id')
    setIsModalOpen(true)
  }

  const handleOpenEdit = (p: RateLimitPolicy) => {
    setEditingPolicy(p)
    setName(p.name)
    setDescription(p.description || '')
    setAlgorithm(p.algorithm)
    setLimit(p.limit)
    setWindowSeconds(p.window_seconds)
    setBurstCapacity(p.burst_capacity)
    setRefillRate(p.refill_rate)
    setRequestCost(p.request_cost)
    setFailureMode(p.failure_mode)
    setDimensions(p.dimensions ? p.dimensions.join(',') : 'tenant_id,route_id')
    setIsModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Omit<RateLimitPolicy, 'id'> = {
      name,
      description,
      algorithm,
      limit: Number(limit),
      window_seconds: Number(windowSeconds),
      burst_capacity: Number(burstCapacity),
      refill_rate: Number(refillRate),
      request_cost: Number(requestCost),
      failure_mode: failureMode,
      dimensions: dimensions.split(',').map(s => s.trim()).filter(Boolean),
      key_pattern: `rl:${algorithm}:{tenant_id}:{route_id}`,
    }

    try {
      if (editingPolicy) {
        await apiService.updatePolicy(editingPolicy.id, payload)
      } else {
        await apiService.createPolicy(payload)
      }
      setIsModalOpen(false)
      fetchPolicies()
    } catch {
      alert('Failed to save policy')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this rate limit policy?')) return
    try {
      await apiService.deletePolicy(id)
      fetchPolicies()
    } catch {
      alert('Failed to delete policy')
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Breadcrumb Ribbon */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 p-5 bg-surface-container-low rounded-xl border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs mb-1">
            <span className="text-primary uppercase tracking-widest font-semibold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px]">tune</span>
              Traffic Shaping Engine
            </span>
            <span className="text-outline">/</span>
            <span className="text-on-surface-variant">Cluster: us-east-1 (Distributed Redis v7.2)</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-on-surface">
              Rate Limit Policies
            </h1>
            <div className="flex items-center gap-2 bg-surface-container px-3 py-1 rounded-full border border-border font-mono text-xs">
              <span className="h-2 w-2 rounded-full bg-secondary"></span>
              <span className="text-on-surface font-semibold">{policies.length} Active</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button onClick={handleOpenCreate} className="btn-primary font-sans font-semibold text-xs">
            <Plus className="w-4 h-4" />
            <span>Create Policy</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-surface-container-low rounded-xl border border-border">
        {/* Search */}
        <div className="relative flex items-center min-w-[240px] flex-1 max-w-md">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-outline" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search policies by name or scope..."
            className="input-field pl-8"
          />
        </div>

        {/* Algorithm Filter */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-outline uppercase text-[10px] font-semibold">Algorithm:</span>
          <select
            value={algorithmFilter}
            onChange={e => setAlgorithmFilter(e.target.value)}
            className="select-field text-xs py-1 px-2.5"
          >
            <option value="all">All Algorithms</option>
            <option value="token_bucket">Token Bucket</option>
            <option value="sliding_window">Sliding Window Counter</option>
            <option value="sliding_window_log">Sliding Window Log</option>
            <option value="fixed_window">Fixed Window</option>
          </select>
        </div>
      </div>

      {/* Policies Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {filteredPolicies.map(pol => (
          <div
            key={pol.id}
            className="card p-5 flex flex-col justify-between hover:border-outline-variant transition-all group"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <h3 className="font-sans font-bold text-base text-on-surface group-hover:text-primary transition-colors">
                    {pol.name}
                  </h3>
                  <p className="font-sans text-xs text-outline line-clamp-2 mt-0.5">
                    {pol.description || 'Configured distributed rate limiting policy'}
                  </p>
                </div>
                <span
                  className={
                    pol.algorithm === 'token_bucket'
                      ? 'badge-cyan'
                      : pol.algorithm === 'sliding_window'
                      ? 'badge-emerald'
                      : pol.algorithm === 'sliding_window_log'
                      ? 'badge-amber'
                      : 'badge-neutral'
                  }
                >
                  {pol.algorithm}
                </span>
              </div>

              {/* Metrics Specs */}
              <div className="grid grid-cols-2 gap-2 my-4 bg-surface-container-lowest p-3 rounded-lg border border-border font-mono text-xs">
                <div>
                  <span className="text-outline text-[10px] uppercase block font-semibold">Limit / Window</span>
                  <span className="text-on-surface font-bold text-sm">
                    {pol.limit.toLocaleString()} / {pol.window_seconds}s
                  </span>
                </div>
                <div>
                  <span className="text-outline text-[10px] uppercase block font-semibold">Burst Capacity</span>
                  <span className="text-secondary font-bold text-sm">
                    {pol.burst_capacity > 0 ? pol.burst_capacity : pol.limit}
                  </span>
                </div>
                <div>
                  <span className="text-outline text-[10px] uppercase block font-semibold">Refill Rate</span>
                  <span className="text-primary font-bold text-sm">
                    {pol.refill_rate ? `${pol.refill_rate}/s` : 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-outline text-[10px] uppercase block font-semibold">Failure Mode</span>
                  <span
                    className={
                      pol.failure_mode === 'fail_open'
                        ? 'text-secondary font-semibold'
                        : pol.failure_mode === 'fail_closed'
                        ? 'text-error font-semibold'
                        : 'text-tertiary font-semibold'
                    }
                  >
                    {pol.failure_mode}
                  </span>
                </div>
              </div>

              {/* Dimensions */}
              <div className="flex flex-wrap items-center gap-1.5 mb-4 font-mono text-[11px]">
                <span className="text-outline text-[10px] uppercase font-semibold">Dimensions:</span>
                {(pol.dimensions || ['tenant_id', 'route_id']).map(d => (
                  <span key={d} className="bg-surface-container px-2 py-0.5 rounded border border-border text-on-surface-variant">
                    {d}
                  </span>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-border font-mono text-xs">
              <span className="text-outline text-[10px]">Cost: {pol.request_cost || 1} token</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleOpenEdit(pol)}
                  className="btn btn-secondary p-1.5"
                  title="Edit Policy"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(pol.id)}
                  className="btn btn-secondary p-1.5 text-error hover:bg-error/15"
                  title="Delete Policy"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 className="font-sans font-bold text-lg text-on-surface">
                {editingPolicy ? 'Edit Policy Parameters' : 'Deploy New Rate Limit Policy'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-outline hover:text-on-surface p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 font-sans text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="font-mono text-xs text-outline block mb-1 font-semibold">
                    Policy Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. tier-pro-standard"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="font-mono text-xs text-outline block mb-1 font-semibold">
                    Algorithm *
                  </label>
                  <select
                    value={algorithm}
                    onChange={e => setAlgorithm(e.target.value as Algorithm)}
                    className="select-field"
                  >
                    <option value="token_bucket">Token Bucket</option>
                    <option value="sliding_window">Sliding Window Counter</option>
                    <option value="sliding_window_log">Sliding Window Log</option>
                    <option value="fixed_window">Fixed Window</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-mono text-xs text-outline block mb-1 font-semibold">
                  Description
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Operational scope, tier allocation..."
                  className="input-field font-sans"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono">
                <div>
                  <label className="text-[11px] text-outline block mb-1 font-semibold">Limit Count</label>
                  <input
                    type="number"
                    required
                    value={limit}
                    onChange={e => setLimit(Number(e.target.value))}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-outline block mb-1 font-semibold">Window (sec)</label>
                  <input
                    type="number"
                    required
                    value={windowSeconds}
                    onChange={e => setWindowSeconds(Number(e.target.value))}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-outline block mb-1 font-semibold">Burst Capacity</label>
                  <input
                    type="number"
                    value={burstCapacity}
                    onChange={e => setBurstCapacity(Number(e.target.value))}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-outline block mb-1 font-semibold">Refill (tokens/s)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={refillRate}
                    onChange={e => setRefillRate(Number(e.target.value))}
                    className="input-field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="font-mono text-xs text-outline block mb-1 font-semibold">
                    Failure Mode (Redis Fallback)
                  </label>
                  <select
                    value={failureMode}
                    onChange={e => setFailureMode(e.target.value as FailureMode)}
                    className="select-field font-mono"
                  >
                    <option value="fail_open">fail_open (High Availability)</option>
                    <option value="fail_closed">fail_closed (Strict Security)</option>
                    <option value="local_fallback">local_fallback (In-Memory Token Bucket)</option>
                  </select>
                </div>
                <div>
                  <label className="font-mono text-xs text-outline block mb-1 font-semibold">
                    Dimensions (comma separated)
                  </label>
                  <input
                    type="text"
                    value={dimensions}
                    onChange={e => setDimensions(e.target.value)}
                    placeholder="tenant_id,route_id,client_ip"
                    className="input-field font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn btn-secondary font-sans"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary font-sans font-semibold">
                  {editingPolicy ? 'Save Changes' : 'Deploy Policy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
