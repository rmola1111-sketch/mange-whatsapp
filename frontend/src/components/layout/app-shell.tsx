import { PropsWithChildren } from 'react'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <main className="flex-1 mr-80 p-12 bg-[#f8fafc]">
        <Topbar />
        {children}
      </main>
    </div>
  )
}
