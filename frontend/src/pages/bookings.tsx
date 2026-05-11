import { useEffect, useState } from 'react'
import { getBookings, Booking } from '../lib/api'
import { toast } from '../components/ui/toaster'

export function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    getBookings()
      .then(setBookings)
      .catch((e: any) => toast({ type: 'error', title: 'שגיאה', message: e.message || 'שגיאה בטעינת תורים' }))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="glass p-10 rounded-[3rem] border border-slate-200 bg-white/50">
      <div className="overflow-hidden">
        <table className="w-full text-right">
          <thead>
            <tr className="text-slate-400 border-b border-slate-100 uppercase text-xs font-black tracking-widest">
              <th className="pb-4">לקוח</th>
              <th className="pb-4">מועד תור</th>
              <th className="pb-4">עסק</th>
              <th className="pb-4 text-left">נוצר ב-</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-slate-400 font-bold">
                  טוען...
                </td>
              </tr>
            ) : bookings.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-slate-400 font-bold">
                  אין תורים
                </td>
              </tr>
            ) : (
              bookings.map(b => (
                <tr key={b.id} className="text-sm">
                  <td className="py-4 font-bold text-slate-700">{b.customer_phone}</td>
                  <td className="py-4 text-blue-600 font-black">{b.datetime}</td>
                  <td className="py-4 text-slate-500">{b.business_name || b.business_id}</td>
                  <td className="py-4 text-left text-slate-400 text-xs">
                    {b.created_at ? new Date(b.created_at).toLocaleString('he-IL') : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
