import React, { useState, useEffect } from 'react'
import {
  FileText,
  Search,
  Download
} from 'lucide-react'
import { apiService } from '../services/api'
import { AuditLogEntry } from '../types/api'

export const AuditLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [actionFilter, setActionFilter] = useState('ALL')

  useEffect(() => {
    const fetch = async () => {
      const list = await apiService.getAuditLogs()
      setLogs(list)
    }
    fetch()
  }, [])

  const filteredLogs = logs.filter(l => {
    const matchesSearch =
      l.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.actor.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.resource_id.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesAction =
      actionFilter === 'ALL' || l.action.startsWith(actionFilter)
    return matchesSearch && matchesAction
  })

  const getActionBadge = (action: string) => {
    if (action.includes('CREATE')) return <span className="badge-emerald text-[10px]">{action}</span>
    if (action.includes('UPDATE') || action.includes('RELOAD')) return <span className="badge-cyan text-[10px]">{action}</span>
    if (action.includes('DELETE') || action.includes('REVOKE')) return <span className="badge-rose text-[10px]">{action}</span>
    return <span className="badge-neutral text-[10px]">{action}</span>
  }

  const exportLogsJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2))
    const dlAnchor = document.createElement('a')
    dlAnchor.setAttribute('href', dataStr)
    dlAnchor.setAttribute('download', `rateshield_audit_logs_${Date.now()}.json`)
    dlAnchor.click()
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 p-5 bg-surface-container-low rounded-xl border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs mb-1">
            <span className="text-primary uppercase tracking-widest font-semibold flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" />
              Compliance & Security
            </span>
            <span className="text-outline">/</span>
            <span className="text-on-surface-variant">Immutable Audit Journal</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-on-surface">
              Control Plane Audit Trail
            </h1>
            <div className="flex items-center gap-2 bg-surface-container px-3 py-1 rounded-full border border-border font-mono text-xs">
              <span className="h-2 w-2 rounded-full bg-secondary"></span>
              <span className="text-on-surface font-semibold">{logs.length} Logged Entries</span>
            </div>
          </div>
        </div>

        <button onClick={exportLogsJson} className="btn-secondary font-mono text-xs flex items-center gap-1.5">
          <Download className="w-4 h-4 text-outline" />
          <span>Export JSON</span>
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
            placeholder="Search actor, action, or target resource..."
            className="input-field pl-8"
          />
        </div>

        <div className="flex items-center gap-1 bg-surface-container-lowest p-1 rounded-lg border border-border">
          {['ALL', 'POLICY', 'ROUTE', 'KEY', 'GATEWAY'].map(act => (
            <button
              key={act}
              onClick={() => setActionFilter(act)}
              className={`px-3 py-1 rounded transition-colors ${
                actionFilter === act
                  ? 'bg-surface-container-high text-primary font-bold shadow-sm'
                  : 'text-outline hover:text-on-surface'
              }`}
            >
              {act}
            </button>
          ))}
        </div>
      </div>

      {/* Logs Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-border text-outline uppercase text-[10px] tracking-wider select-none">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Operator / Actor</th>
                <th className="py-3 px-4">Target Resource</th>
                <th className="py-3 px-4">Details & Mutation Diffs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredLogs.map(l => (
                <tr key={l.id} className="hover:bg-surface-container/60 transition-colors">
                  <td className="py-3 px-4 text-outline whitespace-nowrap">
                    {new Date(l.timestamp).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {getActionBadge(l.action)}
                  </td>
                  <td className="py-3 px-4 font-semibold text-on-surface whitespace-nowrap">
                    {l.actor}
                  </td>
                  <td className="py-3 px-4 text-primary whitespace-nowrap font-bold">
                    <code>{l.resource_id}</code>
                  </td>
                  <td className="py-3 px-4 text-on-surface-variant font-sans text-xs">
                    {l.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
