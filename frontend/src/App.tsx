import React, { useState } from 'react'
import { Navbar } from './components/layout/Navbar'
import { Sidebar, NavTab } from './components/layout/Sidebar'
import { DashboardPage } from './pages/DashboardPage'
import { TrafficInspectorPage } from './pages/TrafficInspectorPage'
import { SandboxPage } from './pages/SandboxPage'
import { PoliciesPage } from './pages/PoliciesPage'
import { RoutesPage } from './pages/RoutesPage'
import { BackendsPage } from './pages/BackendsPage'
import { ApiKeysPage } from './pages/ApiKeysPage'
import { AuditLogsPage } from './pages/AuditLogsPage'
import { DocsPage } from './pages/DocsPage'
import { apiService } from './services/api'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import { Shield, Sun, Moon, Lock, AlertCircle, ArrowRight, Sparkles } from 'lucide-react'

const AppContent: React.FC = () => {
  const { theme, toggleTheme } = useTheme()
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard')
  const [refreshInterval, setRefreshInterval] = useState<number>(2000)
  const [authenticated, setAuthenticated] = useState(apiService.isAuthenticated())
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('change_me_on_first_login')
  const [loading, setLoading] = useState(false)
  const [loginError, setLoginError] = useState('')

  const handleLogin = async (e?: React.FormEvent, customEmail?: string, customPass?: string) => {
    if (e) e.preventDefault()
    setLoginError('')
    setLoading(true)
    const targetEmail = customEmail || email
    const targetPass = customPass || password
    try {
      await apiService.login(targetEmail, targetPass)
      setAuthenticated(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed. Verify credentials.'
      setLoginError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleQuickDemoLogin = () => {
    setEmail('admin@example.com')
    setPassword('change_me_on_first_login')
    handleLogin(undefined, 'admin@example.com', 'change_me_on_first_login')
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-surface text-on-surface p-4 transition-colors relative overflow-hidden">
        {/* Subtle decorative background glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

        <div className="card w-full max-w-md p-6 sm:p-8 space-y-6 shadow-2xl border border-border relative z-10">
          <div className="flex items-center justify-between pb-2 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center font-bold shadow-[0_0_16px_-2px_rgba(6,182,212,0.45)]">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base font-bold text-on-surface leading-tight tracking-tight">RateShield Console</h1>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-mono text-primary font-semibold">v2.4 TELEMETRY</span>
                  <span className="w-1 h-1 rounded-full bg-secondary" />
                  <span className="text-[10px] font-mono text-secondary">STANDALONE READY</span>
                </div>
              </div>
            </div>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-border text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
              title="Toggle Dark/Light Mode"
              type="button"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-tertiary" /> : <Moon className="w-4 h-4 text-primary" />}
            </button>
          </div>

          {/* Quick Demo Helper Banner */}
          <div className="p-3 rounded-lg bg-surface-container-high/60 border border-primary/20 text-xs font-mono space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-primary flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Default Admin Credentials:
              </span>
              <button
                type="button"
                onClick={() => {
                  setEmail('admin@example.com')
                  setPassword('change_me_on_first_login')
                }}
                className="text-[10px] text-primary hover:underline font-mono"
              >
                Auto-fill
              </button>
            </div>
            <div className="text-[10px] text-outline font-mono space-y-0.5">
              <div>Email: <span className="text-on-surface font-semibold">admin@example.com</span></div>
              <div>Password: <span className="text-on-surface font-semibold">change_me_on_first_login</span></div>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="text-[11px] font-mono font-semibold text-outline block mb-1">
                Admin Email
              </label>
              <input
                className="input-field"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@example.com"
              />
            </div>
            <div>
              <label className="text-[11px] font-mono font-semibold text-outline block mb-1">
                Password
              </label>
              <input
                className="input-field"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••••"
              />
            </div>

            {loginError && (
              <div role="alert" className="text-error text-xs font-mono bg-error/10 p-2.5 rounded-lg border border-error/20 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              className="btn-primary w-full py-2.5 font-sans font-semibold text-xs flex items-center justify-center gap-2 shadow-[0_0_16px_-3px_rgba(6,182,212,0.4)]"
              type="submit"
              disabled={loading}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{loading ? 'Authenticating...' : 'Sign In to Console'}</span>
              <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
            </button>

            <button
              type="button"
              onClick={handleQuickDemoLogin}
              disabled={loading}
              className="w-full py-2 text-xs font-mono text-outline hover:text-primary hover:bg-surface-container rounded-lg border border-border transition-colors flex items-center justify-center gap-1.5"
            >
              <span>Instant 1-Click Access</span>
            </button>
          </form>

          <div className="pt-2 border-t border-border/60 text-center font-mono text-[10px] text-outline flex items-center justify-center gap-1.5">
            <span>Control Plane API</span>
            <span className="text-border">•</span>
            <span>RS256 JWT Authentication</span>
          </div>
        </div>
      </main>
    )
  }

  const renderContent = () => {
    switch (currentTab) {
      case 'dashboard':
        return (
          <DashboardPage
            onOpenSandbox={() => setCurrentTab('sandbox')}
            refreshInterval={refreshInterval}
          />
        )
      case 'traffic':
        return <TrafficInspectorPage />
      case 'sandbox':
        return <SandboxPage />
      case 'policies':
        return <PoliciesPage />
      case 'routes':
        return <RoutesPage />
      case 'backends':
        return <BackendsPage />
      case 'keys':
        return <ApiKeysPage />
      case 'logs':
        return <AuditLogsPage />
      case 'docs':
        return <DocsPage />
      default:
        return (
          <DashboardPage
            onOpenSandbox={() => setCurrentTab('sandbox')}
            refreshInterval={refreshInterval}
          />
        )
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface font-sans transition-colors duration-150">
      {/* Top Navbar */}
      <Navbar
        onOpenSandbox={() => setCurrentTab('sandbox')}
        onLogout={() => {
          apiService.logout()
          setAuthenticated(false)
        }}
        refreshInterval={refreshInterval}
        onChangeRefreshInterval={setRefreshInterval}
      />

      {/* Main Console Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar currentTab={currentTab} onSelectTab={setCurrentTab} />

        {/* Primary Viewport */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-surface transition-colors">
          <div className="max-w-7xl mx-auto">{renderContent()}</div>
        </main>
      </div>
    </div>
  )
}

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  )
}

export default App
