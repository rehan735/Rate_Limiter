import React, { useState } from 'react'
import {
  Zap,
  RotateCw,
  Sun,
  Moon,
  Search,
  Bell,
  LogOut
} from 'lucide-react'
import { apiService } from '../../services/api'
import { useTheme } from '../../context/ThemeContext'

interface NavbarProps {
  onOpenSandbox?: () => void
  onLogout?: () => void
  refreshInterval?: number
  onChangeRefreshInterval?: (interval: number) => void
  activeRPS?: number
  dropRatePct?: number
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenSandbox,
  onLogout,
  refreshInterval = 2000,
  onChangeRefreshInterval,
  activeRPS = 14280,
  dropRatePct = 0.42
}) => {
  const { theme, toggleTheme } = useTheme()
  const [reloading, setReloading] = useState(false)
  const [reloadMsg, setReloadMsg] = useState<string | null>(null)
  const [region, setRegion] = useState('Production - us-east-1')

  const handleReload = async () => {
    setReloading(true)
    setReloadMsg(null)
    try {
      const res = await apiService.reloadGatewayConfig()
      setReloadMsg(`Applied in ${res.elapsed_ms}ms`)
      setTimeout(() => setReloadMsg(null), 3500)
    } catch {
      setReloadMsg('Reload failed')
      setTimeout(() => setReloadMsg(null), 3500)
    } finally {
      setReloading(false)
    }
  }

  return (
    <header className="sticky top-0 z-40 h-16 w-full border-b border-border bg-surface/85 backdrop-blur-xl px-4 md:px-6 flex items-center justify-between shadow-[0_1px_8px_rgba(0,0,0,0.04)] transition-colors">
      {/* Left Region & Telemetry Pills */}
      <div className="flex items-center gap-3">
        {/* Cluster / Region Selector */}
        <div className="flex items-center gap-1.5 bg-surface-container px-2.5 py-1.5 rounded-lg border border-border">
          <span className="material-symbols-outlined text-[16px] text-primary">public</span>
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            className="bg-transparent font-mono text-xs text-on-surface focus:outline-none cursor-pointer pr-1"
          >
            <option className="bg-surface-container-high text-on-surface" value="Production - us-east-1">Production - us-east-1</option>
            <option className="bg-surface-container-high text-on-surface" value="Production - eu-west-1">Production - eu-west-1</option>
            <option className="bg-surface-container-high text-on-surface" value="Staging - us-east-2">Staging - us-east-2</option>
          </select>
        </div>

        {/* Live RPS & Drop Rate Badge */}
        <div className="hidden xl:flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-lg border border-border font-mono text-xs">
          <span className="text-[10px] text-outline uppercase font-semibold">RPS:</span>
          <span className="text-on-surface font-semibold">{activeRPS.toLocaleString()} req/s</span>
          <span className="text-outline">•</span>
          <span className="text-error font-medium">{dropRatePct}% 429s</span>
        </div>

        {/* Cluster Status Indicator */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-container-low border border-border">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
          </span>
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-secondary">
            Cluster Nominal
          </span>
        </div>
      </div>

      {/* Right Controls: Search, Simulator, Reload, Polling, Theme, Profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Quick Search */}
        <div className="relative hidden md:flex items-center">
          <Search className="absolute left-2.5 w-4 h-4 text-outline pointer-events-none" />
          <input
            type="text"
            placeholder="Search endpoints, keys, logs..."
            className="bg-surface-container-lowest font-sans text-xs text-on-surface placeholder:text-outline pl-8 pr-12 py-1.5 rounded-lg border border-border focus:outline-none focus:border-primary w-48 lg:w-60 transition-all"
          />
          <kbd className="absolute right-2 font-mono text-[9px] text-outline bg-surface-container-high px-1.5 py-0.5 rounded border border-border pointer-events-none">
            ⌘K
          </kbd>
        </div>

        {/* Simulate Load Shortcut */}
        {onOpenSandbox && (
          <button
            onClick={onOpenSandbox}
            className="hidden sm:flex items-center gap-1.5 bg-primary-container text-on-primary-container px-3 py-1.5 rounded-lg font-sans text-xs font-semibold hover:bg-primary-fixed-dim transition-colors shadow-[0_0_12px_-2px_rgba(6,182,212,0.35)] active:scale-95"
            type="button"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>Simulate Load</span>
          </button>
        )}

        {/* Hot Config Reload Trigger */}
        <button
          onClick={handleReload}
          disabled={reloading}
          className="flex items-center gap-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface px-2.5 py-1.5 rounded-lg border border-border text-xs font-mono transition-colors"
          title="Trigger zero-downtime hot reload of gateway routing and policy tables"
        >
          <RotateCw className={`w-3.5 h-3.5 ${reloading ? 'animate-spin text-primary' : 'text-outline'}`} />
          <span className="hidden lg:inline">{reloading ? 'Reloading...' : 'Reload Config'}</span>
        </button>
        {reloadMsg && (
          <span className="font-mono text-[10px] text-secondary bg-secondary/10 px-2 py-1 rounded border border-secondary/20">
            {reloadMsg}
          </span>
        )}

        {/* Refresh Interval Selector */}
        {onChangeRefreshInterval && (
          <div className="hidden lg:flex items-center gap-1 bg-surface-container px-2 py-1 rounded-lg border border-border text-xs font-mono">
            <span className="text-[10px] text-outline uppercase">Poll:</span>
            <select
              value={refreshInterval}
              onChange={e => onChangeRefreshInterval(parseInt(e.target.value, 10))}
              className="bg-transparent text-xs text-on-surface focus:outline-none cursor-pointer"
            >
              <option value="1000" className="bg-surface-container-high text-on-surface">1s</option>
              <option value="2000" className="bg-surface-container-high text-on-surface">2s</option>
              <option value="5000" className="bg-surface-container-high text-on-surface">5s</option>
              <option value="0" className="bg-surface-container-high text-on-surface">Off</option>
            </select>
          </div>
        )}

        {/* Dark / Light Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container border border-border transition-colors flex items-center justify-center"
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-tertiary" />
          ) : (
            <Moon className="w-4 h-4 text-primary" />
          )}
        </button>

        {/* Notifications Icon */}
        <button
          className="relative p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container border border-border transition-colors"
          type="button"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-tertiary animate-pulse"></span>
        </button>

        {/* Architect Profile Avatar & Sign Out */}
        <div className="flex items-center gap-2 pl-1 border-l border-border">
          <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-primary font-mono text-xs font-bold">
            AD
          </div>
          <div className="hidden md:flex flex-col text-left">
            <span className="font-sans text-xs font-medium text-on-surface leading-tight">admin</span>
            <span className="font-mono text-[9px] text-outline leading-tight">Lead Architect</span>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              className="p-1.5 ml-1 rounded-lg text-outline hover:text-error hover:bg-error/10 border border-transparent hover:border-error/20 transition-colors"
              title="Sign Out of RateShield Console"
              aria-label="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
