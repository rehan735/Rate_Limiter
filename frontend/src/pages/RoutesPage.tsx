import React, { useState, useEffect } from 'react'
import {
  Route as RouteIcon,
  Plus,
  Trash2,
  Edit2,
  Search,
  Server,
  X
} from 'lucide-react'
import { apiService } from '../services/api'
import { Route, BackendService, RateLimitPolicy } from '../types/api'

export const RoutesPage: React.FC = () => {
  const [routes, setRoutes] = useState<Route[]>([])
  const [filteredRoutes, setFilteredRoutes] = useState<Route[]>([])
  const [backends, setBackends] = useState<BackendService[]>([])
  const [policies, setPolicies] = useState<RateLimitPolicy[]>([])
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [editingRoute, setEditingRoute] = useState<Route | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [methodFilter, setMethodFilter] = useState('ALL')

  // Form state
  const [name, setName] = useState('')
  const [pathPattern, setPathPattern] = useState('')
  const [methods, setMethods] = useState<string[]>(['GET'])
  const [backendId, setBackendId] = useState('')
  const [policyId, setPolicyId] = useState('')
  const [stripPrefix, setStripPrefix] = useState(false)
  const [active, setActive] = useState(true)

  const fetchData = async () => {
    const [r, b, p] = await Promise.all([
      apiService.getRoutes(),
      apiService.getBackends(),
      apiService.getPolicies(),
    ])
    setRoutes(r)
    setBackends(b)
    setPolicies(p)
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    let list = routes
    if (searchTerm) {
      list = list.filter(
        r =>
          r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          r.path_pattern.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }
    if (methodFilter !== 'ALL') {
      list = list.filter(r => r.methods.includes(methodFilter))
    }
    setFilteredRoutes(list)
  }, [routes, searchTerm, methodFilter])

  const handleOpenCreate = () => {
    setEditingRoute(null)
    setName('')
    setPathPattern('/api/v1/')
    setMethods(['GET'])
    setBackendId(backends[0]?.id || '')
    setPolicyId(policies[0]?.id || '')
    setStripPrefix(false)
    setActive(true)
    setIsModalOpen(true)
  }

  const handleOpenEdit = (r: Route) => {
    setEditingRoute(r)
    setName(r.name)
    setPathPattern(r.path_pattern)
    setMethods(r.methods)
    setBackendId(r.backend_id)
    setPolicyId(r.policy_id)
    setStripPrefix(r.strip_prefix)
    setActive(r.active ?? true)
    setIsModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Omit<Route, 'id'> = {
      name,
      path_pattern: pathPattern,
      methods,
      backend_id: backendId,
      policy_id: policyId,
      strip_prefix: stripPrefix,
      active,
      cors_enabled: true,
    }

    try {
      if (editingRoute) {
        await apiService.updateRoute(editingRoute.id, payload)
      } else {
        await apiService.createRoute(payload)
      }
      setIsModalOpen(false)
      fetchData()
    } catch {
      alert('Failed to save route')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this ingress route?')) return
    try {
      await apiService.deleteRoute(id)
      fetchData()
    } catch {
      alert('Failed to delete route')
    }
  }

  const handleToggleMethod = (m: string) => {
    setMethods(prev => (prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]))
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 p-5 bg-surface-container-low rounded-xl border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs mb-1">
            <span className="text-primary uppercase tracking-widest font-semibold flex items-center gap-1.5">
              <RouteIcon className="w-3.5 h-3.5" />
              Ingress Multiplexer
            </span>
            <span className="text-outline">/</span>
            <span className="text-on-surface-variant">Data Plane Route Table</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-on-surface">
              Gateway Ingress Routes
            </h1>
            <div className="flex items-center gap-2 bg-surface-container px-3 py-1 rounded-full border border-border font-mono text-xs">
              <span className="h-2 w-2 rounded-full bg-secondary"></span>
              <span className="text-on-surface font-semibold">{routes.length} Active Rules</span>
            </div>
          </div>
        </div>

        <button onClick={handleOpenCreate} className="btn-primary font-sans font-semibold text-xs">
          <Plus className="w-4 h-4" />
          <span>Add Ingress Route</span>
        </button>
      </div>

      {/* Filter Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-surface-container-low rounded-xl border border-border font-mono text-xs">
        <div className="relative flex items-center min-w-[240px] flex-1 max-w-md">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-outline" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search path patterns or backend..."
            className="input-field pl-8"
          />
        </div>

        <div className="flex items-center gap-1 bg-surface-container-lowest p-1 rounded-lg border border-border">
          {['ALL', 'GET', 'POST', 'PUT', 'DELETE'].map(m => (
            <button
              key={m}
              onClick={() => setMethodFilter(m)}
              className={`px-2.5 py-1 rounded transition-colors ${
                methodFilter === m
                  ? 'bg-surface-container-high text-primary font-bold shadow-sm'
                  : 'text-outline hover:text-on-surface'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Routes Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-border text-outline uppercase text-[10px] tracking-wider select-none">
                <th className="py-3 px-4">Route Name</th>
                <th className="py-3 px-4">Methods</th>
                <th className="py-3 px-4">Path Pattern</th>
                <th className="py-3 px-4">Target Backend</th>
                <th className="py-3 px-4">Assigned Policy</th>
                <th className="py-3 px-4">Prefix</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredRoutes.map(r => {
                const bk = backends.find(b => b.id === r.backend_id)
                const pol = policies.find(p => p.id === r.policy_id)

                return (
                  <tr key={r.id} className="hover:bg-surface-container/60 transition-colors">
                    <td className="py-3 px-4 font-semibold text-on-surface whitespace-nowrap">
                      {r.name}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex flex-wrap gap-1">
                        {r.methods.map(m => (
                          <span
                            key={m}
                            className={
                              m === 'GET'
                                ? 'method-get'
                                : m === 'POST'
                                ? 'method-post'
                                : 'method-put'
                            }
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-primary font-bold whitespace-nowrap">
                      {r.path_pattern}
                    </td>
                    <td className="py-3 px-4 text-on-surface whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <Server className="w-3.5 h-3.5 text-secondary" />
                        <span>{bk ? bk.name : r.backend_name || 'user-service'}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="badge-cyan">
                        {pol ? pol.name : r.policy_name || 'tier-standard'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-outline whitespace-nowrap">
                      {r.strip_prefix ? 'Stripped' : 'Preserved'}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenEdit(r)}
                          className="btn btn-secondary p-1.5"
                          title="Edit Route"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(r.id)}
                          className="btn btn-secondary p-1.5 text-error hover:bg-error/15"
                          title="Delete Route"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 className="font-sans font-bold text-base text-on-surface">
                {editingRoute ? 'Edit Gateway Route' : 'Register New Gateway Route'}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-outline hover:text-on-surface p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 font-mono text-xs">
              <div>
                <label className="text-outline block mb-1 font-semibold">Route Identifier</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. users-profile-route"
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-outline block mb-1 font-semibold">Path Pattern</label>
                <input
                  type="text"
                  required
                  value={pathPattern}
                  onChange={e => setPathPattern(e.target.value)}
                  placeholder="/api/v1/users/*"
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-outline block mb-1 font-semibold">Allowed Methods</label>
                <div className="flex flex-wrap gap-2">
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => handleToggleMethod(m)}
                      className={`px-3 py-1 rounded font-bold transition-all ${
                        methods.includes(m)
                          ? 'bg-primary-container text-on-primary-container shadow-sm'
                          : 'bg-surface-container text-outline hover:text-on-surface border border-border'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-outline block mb-1 font-semibold">Upstream Backend</label>
                  <select
                    value={backendId}
                    onChange={e => setBackendId(e.target.value)}
                    className="select-field"
                    required
                  >
                    <option value="" disabled>Select Backend...</option>
                    {backends.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.targets[0]})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-outline block mb-1 font-semibold">Rate Limit Policy</label>
                  <select
                    value={policyId}
                    onChange={e => setPolicyId(e.target.value)}
                    className="select-field"
                    required
                  >
                    <option value="" disabled>Select Policy...</option>
                    {policies.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.algorithm})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="stripPrefix"
                  checked={stripPrefix}
                  onChange={e => setStripPrefix(e.target.checked)}
                  className="rounded accent-primary cursor-pointer"
                />
                <label htmlFor="stripPrefix" className="text-on-surface font-sans text-xs cursor-pointer">
                  Strip path prefix before proxying to backend target
                </label>
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
                  {editingRoute ? 'Save Route' : 'Deploy Route'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
