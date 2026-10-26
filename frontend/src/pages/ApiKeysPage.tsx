import React, { useState, useEffect } from 'react'
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Building,
  Search,
  X
} from 'lucide-react'
import { apiService } from '../services/api'
import { ApiKey, Tenant } from '../types/api'

export const ApiKeysPage: React.FC = () => {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [activeTab, setActiveTab] = useState<'keys' | 'tenants'>('keys')
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false)
  const [isTenantModalOpen, setIsTenantModalOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  // New key form
  const [keyName, setKeyName] = useState('')
  const [tenantId, setTenantId] = useState('')

  // New tenant form
  const [tenantName, setTenantName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')

  // Secret revelation modal
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchData = async () => {
    const [k, t] = await Promise.all([apiService.getApiKeys(), apiService.getTenants()])
    setApiKeys(k)
    setTenants(t)
    if (t.length > 0 && !tenantId) {
      setTenantId(t[0].id)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await apiService.createApiKey({
      name: keyName,
      tenant_id: tenantId,
    })
    setIsKeyModalOpen(false)
    setRevealedSecret(res.secretKey)
    await fetchData()
  }

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    await apiService.createTenant({
      name: tenantName,
      slug: tenantSlug,
    })
    setIsTenantModalOpen(false)
    await fetchData()
  }

  const handleRevoke = async (id: string) => {
    if (confirm('Revoke this API Key permanently? All subsequent requests will return 401 Unauthorized.')) {
      await apiService.revokeApiKey(id)
      await fetchData()
    }
  }

  const filteredKeys = apiKeys.filter(
    k =>
      k.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      k.key_prefix.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const filteredTenants = tenants.filter(
    t =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.slug.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 p-5 bg-surface-container-low rounded-xl border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs mb-1">
            <span className="text-primary uppercase tracking-widest font-semibold flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              Identity & Access Management
            </span>
            <span className="text-outline">/</span>
            <span className="text-on-surface-variant">Multi-Tenant Quota Scopes</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-on-surface">
              API Keys & Tenant Governance
            </h1>
          </div>
        </div>

        {/* Tab Buttons & Trigger */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-surface-container-lowest p-1 rounded-lg border border-border font-mono text-xs">
            <button
              onClick={() => setActiveTab('keys')}
              className={`px-3 py-1.5 rounded transition-colors ${
                activeTab === 'keys'
                  ? 'bg-surface-container-high text-primary font-bold shadow-sm'
                  : 'text-outline hover:text-on-surface'
              }`}
            >
              API Keys ({apiKeys.length})
            </button>
            <button
              onClick={() => setActiveTab('tenants')}
              className={`px-3 py-1.5 rounded transition-colors ${
                activeTab === 'tenants'
                  ? 'bg-surface-container-high text-primary font-bold shadow-sm'
                  : 'text-outline hover:text-on-surface'
              }`}
            >
              Tenants ({tenants.length})
            </button>
          </div>

          {activeTab === 'keys' ? (
            <button onClick={() => setIsKeyModalOpen(true)} className="btn-primary font-sans font-semibold text-xs">
              <Plus className="w-4 h-4" />
              <span>Issue API Key</span>
            </button>
          ) : (
            <button onClick={() => setIsTenantModalOpen(true)} className="btn-primary font-sans font-semibold text-xs">
              <Plus className="w-4 h-4" />
              <span>Register Tenant</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Ribbon */}
      <div className="flex items-center justify-between gap-3 p-3 bg-surface-container-low rounded-xl border border-border font-mono text-xs">
        <div className="relative flex items-center min-w-[240px] flex-1 max-w-md">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-outline" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={`Search ${activeTab === 'keys' ? 'keys by name or prefix' : 'tenants by name or slug'}...`}
            className="input-field pl-8"
          />
        </div>
      </div>

      {/* Secret Revelation Alert Modal */}
      {revealedSecret && (
        <div className="card p-5 bg-primary/10 border-primary/40 space-y-3 animate-slide-down">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[22px]">vpn_key</span>
              <h3 className="font-sans font-bold text-sm text-primary">New API Secret Key Generated</h3>
            </div>
            <button onClick={() => setRevealedSecret(null)} className="text-outline hover:text-on-surface">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="font-sans text-xs text-on-surface leading-relaxed">
            Copy this secret key immediately. For security, it is hashed with Argon2id and will never be displayed again.
          </p>
          <div className="flex items-center justify-between p-3 bg-surface-container-lowest rounded-lg border border-border font-mono text-xs">
            <code className="text-secondary font-bold select-all">{revealedSecret}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(revealedSecret)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="btn btn-secondary px-3 py-1 font-mono text-xs flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-secondary" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Table Section */}
      {activeTab === 'keys' ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="bg-surface-container-lowest border-b border-border text-outline uppercase text-[10px] tracking-wider select-none">
                  <th className="py-3 px-4">Key Name</th>
                  <th className="py-3 px-4">Key Prefix</th>
                  <th className="py-3 px-4">Tenant Scope</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredKeys.map(k => {
                  const t = tenants.find(x => x.id === k.tenant_id)
                  return (
                    <tr key={k.id} className="hover:bg-surface-container/60 transition-colors">
                      <td className="py-3 px-4 font-semibold text-on-surface whitespace-nowrap">
                        {k.name}
                      </td>
                      <td className="py-3 px-4 text-primary font-bold whitespace-nowrap">
                        <code>{k.key_prefix}...</code>
                      </td>
                      <td className="py-3 px-4 text-on-surface whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          <Building className="w-3.5 h-3.5 text-outline" />
                          <span>{t ? t.name : k.tenant_name || 'Global'}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {k.revoked ? (
                          <span className="badge-rose">REVOKED</span>
                        ) : (
                          <span className="badge-emerald">ACTIVE</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-outline whitespace-nowrap">
                        {new Date(k.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {!k.revoked && (
                          <button
                            onClick={() => handleRevoke(k.id)}
                            className="btn btn-secondary text-error hover:bg-error/15 text-xs py-1"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="bg-surface-container-lowest border-b border-border text-outline uppercase text-[10px] tracking-wider select-none">
                  <th className="py-3 px-4">Tenant Name</th>
                  <th className="py-3 px-4">Tenant Slug</th>
                  <th className="py-3 px-4">Tier</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Registered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredTenants.map(t => (
                  <tr key={t.id} className="hover:bg-surface-container/60 transition-colors">
                    <td className="py-3 px-4 font-semibold text-on-surface whitespace-nowrap">
                      {t.name}
                    </td>
                    <td className="py-3 px-4 text-primary font-bold whitespace-nowrap">
                      <code>{t.slug}</code>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="badge-cyan uppercase">{t.tier || 'PRO'}</span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="badge-emerald">ACTIVE</span>
                    </td>
                    <td className="py-3 px-4 text-outline whitespace-nowrap">
                      {new Date(t.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Issue Key Modal */}
      {isKeyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 className="font-sans font-bold text-base text-on-surface">Issue Production API Key</h2>
              <button onClick={() => setIsKeyModalOpen(false)} className="text-outline hover:text-on-surface p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateKey} className="space-y-4 font-mono text-xs">
              <div>
                <label className="text-outline block mb-1 font-semibold">Key Identifier Label</label>
                <input
                  type="text"
                  required
                  value={keyName}
                  onChange={e => setKeyName(e.target.value)}
                  placeholder="e.g. billing-service-worker"
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-outline block mb-1 font-semibold">Tenant Scope</label>
                <select
                  value={tenantId}
                  onChange={e => setTenantId(e.target.value)}
                  className="select-field"
                  required
                >
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsKeyModalOpen(false)}
                  className="btn btn-secondary font-sans"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary font-sans font-semibold">
                  Generate Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register Tenant Modal */}
      {isTenantModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h2 className="font-sans font-bold text-base text-on-surface">Register Tenant Organization</h2>
              <button onClick={() => setIsTenantModalOpen(false)} className="text-outline hover:text-on-surface p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTenant} className="space-y-4 font-mono text-xs">
              <div>
                <label className="text-outline block mb-1 font-semibold">Organization Name</label>
                <input
                  type="text"
                  required
                  value={tenantName}
                  onChange={e => {
                    setTenantName(e.target.value)
                    if (!tenantSlug) {
                      setTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'))
                    }
                  }}
                  placeholder="e.g. Acme Corp"
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-outline block mb-1 font-semibold">Unique Slug (Header Ident)</label>
                <input
                  type="text"
                  required
                  value={tenantSlug}
                  onChange={e => setTenantSlug(e.target.value)}
                  placeholder="e.g. tenant-acme"
                  className="input-field"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsTenantModalOpen(false)}
                  className="btn btn-secondary font-sans"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary font-sans font-semibold">
                  Register Tenant
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
