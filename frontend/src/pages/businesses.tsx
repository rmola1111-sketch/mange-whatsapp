import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Eye, EyeOff, QrCode, RefreshCw, Settings, Trash2 } from 'lucide-react'
import {
  Business,
  createBusiness,
  deleteBusiness,
  getBusinesses,
  toggleBusiness,
  updateBusiness,
} from '../lib/api'
import { useSocket } from '../components/realtime/socket-provider'
import { toast } from '../components/ui/toaster'
import { Button } from '../components/ui/button'

const DEFAULT_SETTINGS = {
  opening_hour: '09:00',
  closing_hour: '18:00',
  appointment_duration: 30,
  timezone: 'Asia/Jerusalem',
}

export function BusinessesPage() {
  const { qrByBusinessId, statusByBusinessId } = useSocket()

  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Minimal dialogs for phase-1 parity: we keep UX similar; deeper shadcn Dialog wiring can be added next.
  const [editId, setEditId] = useState<number | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const selected = useMemo(
    () => businesses.find(b => b.id === editId) || null,
    [businesses, editId],
  )

  async function refresh() {
    setLoading(true)
    try {
      const data = await getBusinesses()
      setBusinesses(data)
    } catch (e: any) {
      toast({ type: 'error', title: 'שגיאה', message: e.message || 'שגיאה בטעינת עסקים' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // Patch connection_status in-memory from socket
  useEffect(() => {
    if (!statusByBusinessId) return
    setBusinesses(prev =>
      prev.map(b => {
        const status = statusByBusinessId[String(b.id)]
        return status ? { ...b, connection_status: status } : b
      }),
    )
  }, [statusByBusinessId])

  async function onToggle(biz: Business) {
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await toggleBusiness(biz.id)
      setBusinesses(prev =>
        prev.map(b => (b.id === biz.id ? { ...b, is_active: res.is_active } : b)),
      )
      toast({
        type: 'success',
        title: 'בוצע',
        message: res.is_active ? 'העסק הופעל' : 'העסק הושהה',
      })
    } catch (e: any) {
      toast({ type: 'error', title: 'שגיאה', message: e.message || 'לא ניתן לעדכן את מצב העסק' })
    } finally {
      setSubmitting(false)
    }
  }

  async function onDeleteConfirm() {
    if (!deleteId) return
    if (submitting) return
    setSubmitting(true)
    try {
      await deleteBusiness(deleteId)
      setBusinesses(prev => prev.filter(b => b.id !== deleteId))
      toast({ type: 'success', title: 'בוצע', message: 'העסק נמחק בהצלחה' })
      setDeleteId(null)
    } catch (e: any) {
      toast({ type: 'error', title: 'שגיאה', message: e.message || 'מחיקת העסק נכשלה' })
    } finally {
      setSubmitting(false)
    }
  }

  // Note: QR flow is preserved via existing socket events. Backend QR trigger endpoint exists in legacy UI.
  // In React phase-1 we only surface the cached QR if available.

  return (
    <div>
      <div className="flex gap-4 mb-10">
        <Button
          variant="outline"
          size="icon"
          onClick={refresh}
          aria-label="Refresh"
          disabled={loading}
        >
          <RefreshCw className="w-5 h-5" />
        </Button>

        <Button
          onClick={() => {
            // In phase 1 we keep legacy creation in existing dashboard.
            // React implementation will add a Dialog next.
            toast({
              type: 'info',
              title: 'בקרוב',
              message: 'מסך הוספת עסק ב-React יתווסף בשלב הבא (כעת שמירה על תאימות).',
            })
          }}
        >
          הוספת עסק
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
        {businesses.map(b => {
          const isActive = Boolean(b.is_active)
          const status = b.connection_status || 'disconnected'
          const connected = status === 'connected'

          return (
            <motion.div
              key={b.id}
              className={`glass p-8 rounded-[3rem] relative group hover:shadow-2xl transition-all duration-500 ${isActive ? '' : 'opacity-40 grayscale'}`}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <div className="flex justify-between items-start mb-8">
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => setDeleteId(b.id)}
                    aria-label="Delete"
                    className="bg-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="w-5 h-5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => onToggle(b)}
                    aria-label="Toggle"
                    className="bg-slate-100 text-slate-400 hover:bg-blue-50 hover:text-blue-500"
                    disabled={submitting}
                  >
                    {isActive ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => setEditId(b.id)}
                    aria-label="Edit"
                    className="bg-slate-100 text-slate-400 hover:bg-slate-200"
                  >
                    <Settings className="w-5 h-5" />
                  </Button>
                </div>

                <div
                  className={`px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider ${connected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                >
                  {connected ? '● Connected' : '○ Pending'}
                </div>
              </div>

              <h3 className="text-2xl font-black text-slate-800 tracking-tight">{b.name}</h3>
              <p className="text-slate-400 font-bold text-sm mt-1">{b.phone || ''}</p>

              <div className="mt-6 space-y-2">
                <div className="flex justify-between text-xs font-bold bg-slate-50/50 p-3 rounded-2xl">
                  <span className="text-slate-400 uppercase">מחיר:</span>
                  <span className="text-slate-900">{b.price || 0}₪</span>
                </div>
                <div className="flex justify-between text-xs font-bold bg-slate-50/50 p-3 rounded-2xl">
                  <span className="text-slate-400 uppercase">מיקום:</span>
                  <span className="text-slate-900">{b.location || 'לא הוגדר'}</span>
                </div>
                <div className="flex justify-between text-xs font-bold bg-slate-50/50 p-3 rounded-2xl">
                  <span className="text-slate-400 uppercase">שעות פעילות:</span>
                  <span className="text-slate-900">
                    {b.opening_hour || DEFAULT_SETTINGS.opening_hour} -{' '}
                    {b.closing_hour || DEFAULT_SETTINGS.closing_hour}
                  </span>
                </div>
              </div>

              <Button
                variant="default"
                className="w-full bg-[#0F172A] hover:bg-black mt-8 py-5 rounded-[1.5rem] shadow-lg"
                onClick={() => {
                  const qr = qrByBusinessId[String(b.id)]
                  if (!qr) {
                    toast({
                      type: 'info',
                      title: 'QR',
                      message: 'QR יופיע אחרי הפעלה/סריקה במערכת הקיימת (שלב הבא: חיבור מלא).',
                    })
                    return
                  }

                  // Keep it simple for phase-1: show QR in toast if needed
                  toast({ type: 'success', title: 'QR זמין', message: 'ה-QR זמין דרך הסוקט (UI מלא בשלב הבא).' })
                }}
              >
                <QrCode className="w-5 h-5" />
                חיבור וואטסאפ
              </Button>
            </motion.div>
          )
        })}
      </div>

      {/* Minimal delete confirmation (no prompt/confirm/alert) */}
      <AnimatePresence>
        {deleteId ? (
          <motion.div
            className="fixed inset-0 bg-slate-900/90 flex items-center justify-center z-[150] backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-white p-10 rounded-[3rem] shadow-2xl w-[420px] text-center relative border border-white/20"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <h2 className="text-2xl font-black text-slate-800 mb-2">מחיקת עסק</h2>
              <p className="text-slate-500 mb-8">האם אתה בטוח שברצונך למחוק?</p>
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setDeleteId(null)} disabled={submitting}>
                  ביטול
                </Button>
                <Button variant="destructive" className="flex-1" onClick={onDeleteConfirm} disabled={submitting}>
                  מחיקה
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Minimal edit placeholder (phase 1 is non-breaking; full dialog in phase 1.1) */}
      <AnimatePresence>
        {editId && selected ? (
          <motion.div
            className="fixed inset-0 bg-slate-900/90 flex items-center justify-center z-[150] backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-white p-10 rounded-[3rem] shadow-2xl w-[520px] text-right relative border border-white/20"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-black text-slate-800">עריכת עסק</h2>
                  <p className="text-slate-400 text-sm mt-1">{selected.name}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setEditId(null)}>
                  ✕
                </Button>
              </div>

              <p className="text-slate-600 text-sm font-bold">
                UI מלא לעריכה (כולל ולידציה + הגדרות) יתווסף בשלב הבא.\nכרגע שמירה על תאימות מלאה בלי לגעת בזרימת הפרודקשן.
              </p>

              <div className="flex gap-3 mt-8">
                <Button variant="secondary" className="flex-1" onClick={() => setEditId(null)}>
                  סגור
                </Button>
                <Button
                  className="flex-1"
                  onClick={async () => {
                    setSubmitting(true)
                    try {
                      await updateBusiness(selected.id, { name: selected.name })
                      toast({ type: 'success', title: 'בוצע', message: 'עודכן' })
                      await refresh()
                      setEditId(null)
                    } catch (e: any) {
                      toast({ type: 'error', title: 'שגיאה', message: e.message || 'עדכון נכשל' })
                    } finally {
                      setSubmitting(false)
                    }
                  }}
                  disabled={submitting}
                >
                  שמירה (דמו)
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
