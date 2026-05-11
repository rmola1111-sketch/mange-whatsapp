import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/app-shell'
import { BusinessesPage } from './pages/businesses'
import { BookingsPage } from './pages/bookings'
import { AnalyticsPage } from './pages/analytics'
import { ChatPage } from './pages/chat'
import { SocketProvider } from './components/realtime/socket-provider'
import { Toaster } from './components/ui/toaster'

export default function App() {
  return (
    <SocketProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/businesses" replace />} />
          <Route path="/businesses" element={<BusinessesPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/chat" element={<ChatPage />} />
        </Routes>
      </AppShell>
      <Toaster />
    </SocketProvider>
  )
}
