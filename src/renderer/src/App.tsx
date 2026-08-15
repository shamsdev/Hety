import { useEffect, type ReactNode } from 'react'
import { useApp, DEFAULT_TAB } from './store'
import Gate from './components/Gate'
import Sidebar from './components/Sidebar'
import ProjectGallery from './components/ProjectGallery'
import Workspace from './components/Workspace'
import CommandPalette from './components/CommandPalette'
import TabSwitcher from './components/TabSwitcher'
import { Toaster } from './lib/toast'
import { cn } from './lib/ui'

export default function App(): ReactNode {
  const ready = useApp((s) => s.ready)
  const selectedProjectId = useApp((s) => s.selectedProjectId)
  const openProjectIds = useApp((s) => s.openProjectIds)
  const activeTab = useApp((s) => (selectedProjectId ? s.activeTab[selectedProjectId] : undefined))
  const touchPlace = useApp((s) => s.touchPlace)

  // Record wherever we land as the most recent place, for Ctrl+Tab.
  useEffect(() => {
    if (selectedProjectId) touchPlace(selectedProjectId, activeTab ?? DEFAULT_TAB)
  }, [selectedProjectId, activeTab, touchPlace])

  if (!ready)
    return (
      <>
        <Gate />
        <Toaster />
      </>
    )

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <div className="relative min-w-0 flex-1">
        {/* Gallery stays available; workspaces stay mounted so connections survive project switches. */}
        <div className={cn('h-full', selectedProjectId ? 'hidden' : 'block')}>
          <ProjectGallery />
        </div>
        {openProjectIds.map((id) => (
          <div key={id} className={cn('h-full', selectedProjectId === id ? 'block' : 'hidden')}>
            <Workspace projectId={id} visible={selectedProjectId === id} />
          </div>
        ))}
      </div>
      <CommandPalette />
      <TabSwitcher />
      <Toaster />
    </div>
  )
}
