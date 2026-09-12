import type { DragEndEvent } from '@dnd-kit/core'
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * Which playlist the Creator panel is showing. Kept above the router so it
 * survives moving between the inbox, the library and the playlists page, and
 * remembered per browser so a supe comes back to the list they were building.
 *
 * Drops from the middle column are handled by the panel, but the DndContext
 * that sees them lives in the layout; the panel registers its handler here.
 */
const STORAGE_KEY = 'sequel.creator.playlist'
const COLLAPSED_KEY = 'sequel.creator.collapsed'

type DropHandler = (e: DragEndEvent) => void

type CreatorApi = {
  playlistId: string | null
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  open: (id: string | null) => void
  setDropHandler: (h: DropHandler | null) => void
  handleDrop: DropHandler
}

const CreatorContext = createContext<CreatorApi | null>(null)

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function loadStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function CreatorProvider({ children }: { children: ReactNode }) {
  const [playlistId, setPlaylistId] = useState<string | null>(loadStored)
  const [collapsed, setCollapsedState] = useState<boolean>(loadCollapsed)
  const handler = useRef<DropHandler | null>(null)

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v)
    try {
      localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0')
    } catch {
      // Not remembering is fine.
    }
  }, [])

  // Opening a playlist while the panel is away brings it back — otherwise
  // clicking Edit in creator looks like it did nothing.
  const open = useCallback((id: string | null) => {
    setPlaylistId(id)
    if (id) setCollapsed(false)
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Not remembering is fine.
    }
  }, [])

  const setDropHandler = useCallback((h: DropHandler | null) => {
    handler.current = h
  }, [])

  const handleDrop = useCallback<DropHandler>((e) => handler.current?.(e), [])

  const api = useMemo(
    () => ({ playlistId, collapsed, setCollapsed, open, setDropHandler, handleDrop }),
    [playlistId, collapsed, setCollapsed, open, setDropHandler, handleDrop],
  )
  return <CreatorContext value={api}>{children}</CreatorContext>
}

export function useCreator(): CreatorApi {
  const ctx = use(CreatorContext)
  if (!ctx) throw new Error('useCreator outside CreatorProvider')
  return ctx
}
