import { useEffect, useMemo, useState } from 'react'
import { getBookings, getBusinesses, Booking, Business } from '../lib/api'
import { toast } from '../components/ui/toaster'

export function AnalyticsPage() {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])

  useEffect(() => {
    Promise.all([getBusinesses(), getBookings()])
      .then(([biz, book]) => {
        setBusinesses(biz)
        setBookings(book)
      })
      .catch((e: any) => toast({ type: 'error', title: 'שגיאה', message: e.message || 'שגיאה בטעינת נתונים' }))
  }, [])

  const activeBusinesses = useMemo(
    () => businesses.filter(b => Boolean(b.is_active)).length,
    [businesses],
  )

  const connectedBusinesses = useMemo(
    () => businesses.filter(b => b.connection_status === 'connected').length,
    [businesses],
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="glass p-8 rounded-[3rem]">
        <div className="text-slate-400 text-xs font-black uppercase tracking-widest">Bookings</div>
        <div className="text-4xl font-black text-slate-900 mt-2">{bookings.length}</div>
      </div>

      <div className="glass p-8 rounded-[3rem]">
        <div className="text-slate-400 text-xs font-black uppercase tracking-widest">Active businesses</div>
        <div className="text-4xl font-black text-slate-900 mt-2">{activeBusinesses}</div>
      </div>

      <div className="glass p-8 rounded-[3rem]">
        <div className="text-slate-400 text-xs font-black uppercase tracking-widest">Connected</div>
        <div className="text-4xl font-black text-slate-900 mt-2">{connectedBusinesses}</div>
      </div>

      <div className="glass p-10 rounded-[3rem] lg:col-span-3">
        <div className="text-slate-900 font-black text-xl mb-2">Coming next</div>
        <p className="text-slate-500 font-bold">
          גרפים, טרנדים בזמן אמת, פעילות אחרונה ומדדים מתקדמים יתווספו אחרי חיבור צ'אט/אירועים.
        </p>
      </div>
    </div>
  )
}
