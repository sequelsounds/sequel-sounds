import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Creator from '../components/staff/Creator'
import Player from '../components/staff/Player'
import Rail from '../components/staff/Rail'
import { CreatorProvider, useCreator } from '../lib/creator'
import { PlayerProvider } from '../lib/player'

/**
 * The staff shell: rail, workspace, Creator, and a player that spans the
 * bottom. The player and the Creator's state live here, above the routes, so
 * neither resets when the person moves between projects.
 */
export default function StaffLayout() {
  return (
    <PlayerProvider>
      <CreatorProvider>
        <Shell />
      </CreatorProvider>
    </PlayerProvider>
  )
}

// Drops land where the pointer is, not where the dragged rectangle happens to
// overlap most — a track dragged from a wide table row would otherwise "hit"
// the wrong line in the narrow Creator.
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  return within.length > 0 ? within : rectIntersection(args)
}

function Shell() {
  const creator = useCreator()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [dragLabel, setDragLabel] = useState<string | null>(null)

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as
      | { type: 'track'; track: { title: string } }
      | { type: 'pt'; pt: { track: { title: string } | null } }
      | undefined
    if (d?.type === 'track') setDragLabel(d.track.title)
    else if (d?.type === 'pt') setDragLabel(d.pt.track?.title ?? 'Track')
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={(e) => {
        setDragLabel(null)
        creator.handleDrop(e)
      }}
      onDragCancel={() => setDragLabel(null)}
    >
      <div
        className="grid h-screen overflow-hidden bg-sequel-silver text-[14px] leading-[1.4] text-sequel-ink"
        style={{
          gridTemplateColumns: 'clamp(150px, 17vw, 232px) minmax(0, 1fr) clamp(240px, 28vw, 340px)',
          gridTemplateRows: '1fr 72px',
        }}
      >
        <Rail />
        <main className="flex min-w-0 flex-col overflow-hidden">
          <Outlet />
        </main>
        <Creator />
        <Player />
      </div>
      <DragOverlay dropAnimation={null}>
        {dragLabel && (
          <div className="max-w-[280px] truncate bg-sequel-brown px-3 py-2 text-[13px] text-sequel-silver shadow-lg">
            {dragLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
