import { NavLink } from 'react-router-dom'
import { BarChart3, Calendar, LayoutGrid, MessageSquare } from 'lucide-react'
import { cn } from '../../lib/utils'

const nav = [
  { to: '/businesses', label: 'ניהול עסקים', icon: LayoutGrid },
  { to: '/bookings', label: 'יומן תורים', icon: Calendar },
  // Phase 3+ (UI ready, backend wiring later)
  { to: '/chat', label: 'מרכז שיחות', icon: MessageSquare },
  { to: '/analytics', label: 'אנליטיקה', icon: BarChart3 },
]

export function Sidebar() {
  return (
    <aside className="w-80 bg-[#0F172A] text-slate-300 p-8 fixed right-0 top-0 h-full z-50 shadow-2xl">
      <div className="flex items-center gap-4 mb-12 px-2">
        <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
          <span className="text-white font-black">N</span>
        </div>
        <span className="text-2xl font-black text-white tracking-tighter uppercase">
          Nexus<span className="text-blue-500">SaaS</span>
        </span>
      </div>

      <nav className="space-y-4">
        {nav.map(item => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'w-full p-4 rounded-2xl flex items-center gap-4 font-bold transition-all hover:bg-slate-800',
                  isActive &&
                    'bg-blue-600 text-white shadow-xl shadow-blue-500/20 hover:bg-blue-600',
                )
              }
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
