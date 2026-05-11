import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type SocketContextValue = {
  socket: Socket | null
  isConnected: boolean
  qrByBusinessId: Record<string, string>
  statusByBusinessId: Record<string, string>
}

const SocketContext = createContext<SocketContextValue | null>(null)

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false)
  const [qrByBusinessId, setQrByBusinessId] = useState<Record<string, string>>({})
  const [statusByBusinessId, setStatusByBusinessId] = useState<Record<string, string>>({})

  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    // Prevent duplicate connections in strict mode
    if (socketRef.current) return

    const socket = io({
      transports: ['websocket', 'polling'],
    })

    socketRef.current = socket

    const onConnect = () => setIsConnected(true)
    const onDisconnect = () => setIsConnected(false)

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)

    socket.onAny((event, payload) => {
      const [type, ...rest] = String(event).split('_')
      if (rest.length === 0) return
      const id = rest.join('_')

      if (type === 'qr' && payload?.qr) {
        setQrByBusinessId(prev => ({ ...prev, [id]: payload.qr }))
      }

      if (type === 'status' && payload?.status) {
        setStatusByBusinessId(prev => ({ ...prev, [id]: payload.status }))
      }
    })

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.removeAllListeners()
      socket.close()
      socketRef.current = null
    }
  }, [])

  const value = useMemo<SocketContextValue>(
    () => ({
      socket: socketRef.current,
      isConnected,
      qrByBusinessId,
      statusByBusinessId,
    }),
    [isConnected, qrByBusinessId, statusByBusinessId],
  )

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}

export function useSocket() {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSocket must be used within SocketProvider')
  return ctx
}
