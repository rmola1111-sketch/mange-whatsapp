import { useLocation } from 'react-router-dom'

const titles: Record<string, { title: string; subtitle: string }> = {
  '/businesses': { title: 'ניהול עסקים', subtitle: 'מרכז השליטה האוטומטי שלך' },
  '/bookings': { title: 'יומן תורים', subtitle: 'מעקב וניהול תורים' },
  '/chat': { title: 'מרכז שיחות', subtitle: 'WhatsApp בזמן אמת' },
  '/analytics': { title: 'אנליטיקה', subtitle: 'מדדים ותובנות' },
}

export function Topbar() {
  const loc = useLocation()
  const meta = titles[loc.pathname] || titles['/businesses']

  return (
    <header className="flex justify-between items-center mb-12">
      <div>
        <h1 className="text-4xl font-black text-slate-900 tracking-tight">
          {meta.title}
        </h1>
        <p className="text-slate-500 mt-2 text-lg font-medium italic">
          {meta.subtitle}
        </p>
      </div>
    </header>
  )
}
