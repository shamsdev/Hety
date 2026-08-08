import { type ReactNode } from 'react'
import { useApp } from './store'
import Gate from './components/Gate'
import Sidebar from './components/Sidebar'
import ProjectGallery from './components/ProjectGallery'
import Workspace from './components/Workspace'
import { Toaster } from './lib/toast'
import { cn } from './lib/ui'

export default function App(): ReactNode {
  const ready = useApp((s) => s.ready)
  const selectedProjectId = useApp((s) => s.selectedProjectId)
  const openProjectIds = useApp((s) => s.openProjectIds)

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
      <Toaster />
    </div>
  )
}
