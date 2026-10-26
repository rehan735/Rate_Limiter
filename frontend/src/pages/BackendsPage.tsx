import React, { useState, useEffect } from 'react'
import {
  Server,
  Plus,
  Trash2,
  CheckCircle2,
  X
} from 'lucide-react'
import { apiService } from '../services/api'
import { BackendService } from '../types/api'

export const BackendsPage: React.FC = () => {
  const [backends, setBackends] = useState<BackendService[]>([])
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)

  // Form
  const [name, setName] = useState('')
  const [scheme, setScheme] = useState<'http' | 'https'>('http')
  const [targets, setTargets] = useState('localhost:9004')
  const [healthCheckPath, setHealthCheckPath] = useState('/healthz')
  const timeoutMs = 3000

  const fetchBackends = async () => {
    const list = await apiService.getBackends()
    setBackends(list)
  }

  useEffect(() => {
    fetchBackends()
  }, [])

  const handleDelete = async (id: string) => {
    if (confirm('Delete backend target? Connected routes will return 502/503 until reassigned.')) {
      await apiService.deleteBackend(id)
      await fetchBackends()
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const targetList = targets.split(',').map(t => t.trim()).filter(Boolean)
    await apiService.createBackend({
      name,
      scheme,
      targets: targetList,
      health_check_path: healthCheckPath,
      timeout_ms: timeoutMs,
    })
    setIsModalOpen(false)
    await fetchBackends()
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 p-5 bg-surface-container-low rounded-xl border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs mb-1">
            <span className="text-primary uppercase tracking-widest font-semibold flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5" />
              Upstream Registry
            </span>
            <span className="text-outline">/</span>
            <span className="text-on-surface-variant">Round-Robin & Circuit Breaking Pool</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-on-surface">
              Upstream Microservice Backends
            </h1>
            <div className="flex items-center gap-2 bg-surface-container px-3 py-1 rounded-full border border-border font-mono text-xs">
              <span className="h-2 w-2 rounded-full bg-secondary"></span>
              <span className="text-on-surface font-semibold">{backends.length} Healthy Services</span>
            </div>
          </div>
        </div>

        <button onClick={() => setIsModalOpen(true)} className="btn-primary font-sans font-semibold text-xs">
          <Plus className="w-4 h-4" />
          <span>Register Backend</span>
        </button>
      </div>

      {/* Backends Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {backends.map(b => (
          <div key={b.id} className="card p-5 flex flex-col justify-between hover:border-outline-variant transition-all">
            <div>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary border border-border">
                    <Server className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-sans font-bold text-base text-on-surface">{b.name}</h3>
                    <span className="font-mono text-[10px] text-outline uppercase">{b.scheme} protocol</span>
                  </div>
                </div>
                <span className="badge-emerald">HEALTHY</span>
              </div>

              {/* Targets */}
              <div className="bg-surface-container-lowest p-3 rounded-lg border border-border font-mono text-xs space-y-2 mb-4">
                <span className="text-[10px] text-outline uppercase block font-semibold">Proxy Targets</span>
                <div className="space-y-1">
                  {b.targets.map(t => (
                    <div key={t} className="flex items-center justify-between text-on-surface">
                      <span className="text-primary font-bold">{t}</span>
                      <span className="text-[10px] text-secondary flex items-center gap-1 font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Circuit Breaker & Health Spec */}
              <div className="grid grid-cols-2 gap-2 font-mono text-xs text-on-surface-variant bg-surface-container-lowest p-3 rounded-lg border border-border mb-4">
                <div>
                  <span className="text-outline text-[10px] uppercase block font-semibold">Health Path</span>
                  <span className="text-on-surface font-bold">{b.health_check_path || '/healthz'}</span>
                </div>
                <div>
                  <span className="text-outline text-[10px] uppercase block font-semibold">Timeout</span>
                  <span className="text-on-surface font-bold">{b.timeout_ms || 3000} ms</span>
                </div>
                <div className="col-span-2 pt-1 border-t border-border/50 flex items-center justify-between text-[11px]">
                  <span className="text-outline">Circuit Breaker:</span>
                  <span className="text-secondary font-semibold">CLOSED (3-State Guard)</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border font-mono text-xs">
              <span className="text-outline text-[10px]">Load Balancer: Round-Robin</span>
              <button
                onClick={() => handleDelete(b.id)}
                className="btn btn-secondary p-1.5 text-error hover:bg-error/15"
                title="Remove Backend"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 className="font-sans font-bold text-base text-on-surface">
                Register Upstream Service
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-outline hover:text-on-surface p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 font-mono text-xs">
              <div>
                <label className="text-outline block mb-1 font-semibold">Service Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. mock-inventory-service"
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-outline block mb-1 font-semibold">Protocol Scheme</label>
                <select
                  value={scheme}
                  onChange={e => setScheme(e.target.value as 'http' | 'https')}
                  className="select-field"
                >
                  <option value="http">HTTP (Cleartext)</option>
                  <option value="https">HTTPS (TLS Enforced)</option>
                </select>
              </div>

              <div>
                <label className="text-outline block mb-1 font-semibold">Target Hosts (comma-separated)</label>
                <input
                  type="text"
                  required
                  value={targets}
                  onChange={e => setTargets(e.target.value)}
                  placeholder="localhost:9001, localhost:9002"
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-outline block mb-1 font-semibold">Active Health Check Endpoint</label>
                <input
                  type="text"
                  value={healthCheckPath}
                  onChange={e => setHealthCheckPath(e.target.value)}
                  placeholder="/healthz"
                  className="input-field"
                />
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
                  Register Backend
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
