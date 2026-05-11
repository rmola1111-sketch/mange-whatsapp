import * as Toast from '@radix-ui/react-toast'
import { useCallback, useMemo, useState } from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

type ToastType = 'success' | 'error' | 'info'

type ToastItem = {
  id: string
  type: ToastType
  title?: string
  message: string
}

let pushToast: ((t: Omit<ToastItem, 'id'>) => void) | null = null

export function toast(t: Omit<ToastItem, 'id'>) {
  pushToast?.(t)
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  const add = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`
    setItems(prev => [{ id, ...t }, ...prev].slice(0, 4))
  }, [])

  useMemo(() => {
    pushToast = add
    return null
  }, [add])

  const remove = (id: string) => setItems(prev => prev.filter(t => t.id !== id))

  return (
    <Toast.Provider swipeDirection="left">
      {items.map(t => {
        const Icon =
          t.type === 'success'
            ? CheckCircle2
            : t.type === 'error'
              ? XCircle
              : Info

        return (
          <Toast.Root
            key={t.id}
            className={cn(
              'glass bg-white/90 shadow-2xl rounded-2xl px-4 py-3 flex gap-3 items-start ring-1',
              t.type === 'success' && 'ring-emerald-200',
              t.type === 'error' && 'ring-red-200',
              t.type === 'info' && 'ring-blue-200',
            )}
            duration={3200}
            onOpenChange={open => {
              if (!open) remove(t.id)
            }}
          >
            <div className="mt-0.5">
              <Icon
                className={cn(
                  'w-5 h-5',
                  t.type === 'success' && 'text-emerald-600',
                  t.type === 'error' && 'text-red-600',
                  t.type === 'info' && 'text-blue-600',
                )}
              />
            </div>
            <div className="flex-1">
              {t.title ? (
                <Toast.Title className="text-sm font-black text-slate-900">
                  {t.title}
                </Toast.Title>
              ) : null}
              <Toast.Description className="text-sm font-bold text-slate-600 leading-snug">
                {t.message}
              </Toast.Description>
            </div>
            <Toast.Close className="text-slate-300 hover:text-slate-900 transition-colors" aria-label="Close">
              <X className="w-4 h-4" />
            </Toast.Close>
          </Toast.Root>
        )
      })}

      <Toast.Viewport className="fixed top-6 left-6 z-[200] space-y-3 w-[340px] max-w-[calc(100vw-3rem)] outline-none" />
    </Toast.Provider>
  )
}
