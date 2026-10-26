import React from 'react'
import {
  LayoutDashboard,
  Sliders,
  Route as RouteIcon,
  Server,
  KeyRound,
  FileText,
  BookOpen,
  Hourglass,
  ScanEye,
  Shield
} from 'lucide-react'

export type NavTab =
  | 'dashboard'
  | 'traffic'
  | 'policies'
  | 'sandbox'
  | 'routes'
  | 'backends'
  | 'keys'
  | 'logs'
  | 'docs'

interface SidebarProps {
  currentTab: NavTab
  onSelectTab: (tab: NavTab) => void
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab }) => {
  const navSections = [
    {
      title: 'Telemetry & Streams',
      items: [
        { id: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
        { id: 'traffic' as NavTab, label: 'Live Traffic Inspector', icon: ScanEye, badge: 'Live' },
        { id: 'sandbox' as NavTab, label: 'Token Bucket Simulator', icon: Hourglass, badge: 'Lab' },
      ],
    },
    {
      title: 'Control Plane',
      items: [
        { id: 'policies' as NavTab, label: 'Rate Limit Policies', icon: Sliders },
        { id: 'routes' as NavTab, label: 'Gateway Routes', icon: RouteIcon },
        { id: 'backends' as NavTab, label: 'Upstream Backends', icon: Server },
      ],
    },
    {
      title: 'Governance & Security',
      items: [
        { id: 'keys' as NavTab, label: 'API Keys & Tenants', icon: KeyRound },
        { id: 'logs' as NavTab, label: 'Audit Trail', icon: FileText },
        { id: 'docs' as NavTab, label: 'API Reference', icon: BookOpen },
      ],
    },
  ]

  return (
    <aside className="w-64 border-r border-border bg-surface-container-low flex flex-col justify-between shrink-0 select-none transition-colors">
      <div className="flex flex-col">
        {/* Brand Header */}
        <div className="h-16 px-4 flex items-center gap-2.5 bg-surface-container-lowest border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center font-bold shadow-[0_0_12px_-2px_rgba(6,182,212,0.4)]">
            <Shield className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="font-sans font-bold text-sm tracking-tight text-on-surface leading-none">
              RateShield
            </span>
            <span className="font-mono text-[9px] text-primary tracking-wider font-semibold mt-1">
              v2.4 ENTERPRISE
            </span>
          </div>
        </div>

        {/* Control Plane Status Badge */}
        <div className="px-4 py-2.5">
          <div className="flex items-center justify-between px-2 py-1 mb-1 rounded bg-surface-container border border-border">
            <span className="font-mono text-[10px] text-outline uppercase tracking-wider font-semibold">
              Control Plane
            </span>
            <span className="font-mono text-[10px] font-semibold text-secondary bg-secondary/15 px-1.5 py-0.5 rounded">
              ONLINE
            </span>
          </div>
        </div>

        {/* Nav Sections */}
        <div className="space-y-4 px-3">
          {navSections.map(section => (
            <div key={section.title}>
              <span className="text-[10px] font-mono font-semibold text-outline uppercase tracking-wider px-2 block mb-1">
                {section.title}
              </span>
              <nav className="space-y-0.5">
                {section.items.map(item => {
                  const Icon = item.icon
                  const active = currentTab === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => onSelectTab(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-sans transition-all ${
                        active
                          ? 'bg-primary-container text-on-primary-container font-semibold shadow-sm'
                          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`w-4 h-4 ${active ? 'text-on-primary-container' : 'text-outline'}`} />
                        <span>{item.label}</span>
                      </div>
                      {item.badge && (
                        <span
                          className={`px-1.5 py-0.5 text-[9px] font-mono font-semibold rounded ${
                            active
                              ? 'bg-on-primary-container/20 text-on-primary-container'
                              : 'bg-primary/10 text-primary border border-primary/20'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </nav>
            </div>
          ))}
        </div>
      </div>

      {/* Cluster Quota Capacity Indicator Footer */}
      <div className="p-3 bg-surface-container-lowest m-3 rounded-xl border border-border shadow-sm">
        <div className="flex items-center justify-between mb-1.5 font-mono text-xs">
          <span className="text-[10px] text-outline uppercase font-semibold">Cluster Quota</span>
          <span className="text-primary font-bold">84.2%</span>
        </div>
        <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: '84.2%' }}
          ></div>
        </div>
        <div className="flex items-center justify-between mt-2 font-mono text-[10px] text-outline">
          <span>42.1M / 50.0M req</span>
          <span className="text-secondary font-medium">98.6% OK</span>
        </div>
      </div>
    </aside>
  )
}
