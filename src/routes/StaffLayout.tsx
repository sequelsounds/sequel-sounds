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
import { Outlet, useLocation } from 'react-router-dom'
import Coda from '../components/staff/Coda'
import Creator from '../components/staff/Creator'
import { ChevronIcon } from '../components/staff/icons'
import Player from '../components/staff/Player'
import Rail from '../components/staff/Rail'
import StudioRail from '../components/staff/StudioRail'
import { CreatorProvider, useCreator } from '../lib/creator'
import { PlayerProvider } from '../lib/player'

/**
 * The staff shell: Track's nav, the workspace, and — on the pages that are
 * about audio — the Creator and a player across the bottom.
 *
 * The player and the Creator mount for the music pages only. They used to be
 * here for every route, which put a transport bar and a playlist panel across
 * the bottom of a page of invoices. Their providers stay above the routes
 * either way, so a playlist survives a trip to a project and back.
 */

/** The pages the player and the Creator belong to. */
const MUSIC = /^\/(playlists|library|studio)(\/|$)/
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
  const music = MUSIC.test(useLocation().pathname)
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
          // The Creator's column is what animates. Its panel keeps its full
          // 24rem the whole way and is clipped by the wrapper, so nothing
          // inside reflows while it slides away.
          gridTemplateColumns: `16rem minmax(0, 1fr) ${
            music && !creator.collapsed ? '24rem' : '0rem'
          }`,
          // top_spacer_app, the workspace, then the player — which takes no
          // room at all on a page that has no player.
          gridTemplateRows: music ? '2rem 1fr 72px' : '2rem 1fr 0px',
          transition: 'grid-template-columns 280ms cubic-bezier(.25,.46,.45,.94)',
        }}
      >
        {/* The strip starts after the nav, so the rail's edge runs unbroken
            from the top of the window to the player. Placement is explicit
            rather than by source order: the rail spans two rows, which auto
            flow would otherwise have to guess at. */}
        <div className="col-start-2 col-span-2 row-start-1 border-b border-sequel-line" />
        {music ? <StudioRail /> : <Rail />}
        <main className="col-start-2 row-start-2 flex min-w-0 flex-col overflow-hidden">
          <Outlet />
        </main>
        {music && (
          <>
            <div
              className={`col-start-3 row-start-2 z-[2] overflow-hidden ${
                // A plain rule rather than a drop shadow: the shadow spilled
                // down onto the white player bar and looked like a smudge.
                creator.collapsed ? '' : 'border-l border-sequel-line'
              }`}
            >
              <Creator />
            </div>
            {/* Rides the panel's own edge, open or shut, so the control never
                moves anywhere but with the thing it moves. */}
            <button
              type="button"
              className={`creator-tab ${creator.collapsed ? 'is-collapsed' : ''}`}
              title={
                creator.collapsed
                  ? 'Show the Playlist Creator'
                  : 'Hide the Playlist Creator'
              }
              aria-label={
                creator.collapsed
                  ? 'Show the Playlist Creator'
                  : 'Hide the Playlist Creator'
              }
              aria-expanded={!creator.collapsed}
              onClick={() => creator.setCollapsed(!creator.collapsed)}
            >
              <ChevronIcon
                size="0.75rem"
                className={creator.collapsed ? 'rotate-90' : '-rotate-90'}
              />
            </button>
            <Player />
          </>
        )}
      </div>
      {/* Coda sits above the grid rather than in it: she is fixed to the
          window's bottom right, the way she is in the old app, and a grid cell
          would make her a column. */}
      {/* Not on Studio's pages. */}
      {!music && <Coda />}
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
