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

type DropHandler = (e: DragEndEvent) => void

type CreatorApi = {
  playlistId: string | null
  open: (id: string | null) => void
  setDropHandler: (h: DropHandler | null) => void
  handleDrop: DropHandler
}

const CreatorContext = createContext<CreatorApi | null>(null)

function loadStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function CreatorProvider({ children }: { children: ReactNode }) {
  const [playlistId, setPlaylistId] = useState<string | null>(loadStored)
  const handler = useRef<DropHandler | null>(null)

  const open = useCallback((id: string | null) => {
    setPlaylistId(id)
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
    () => ({ playlistId, open, setDropHandler, handleDrop }),
    [playlistId, open, setDropHandler, handleDrop],
  )
  return <CreatorContext value={api}>{children}</CreatorContext>
}

export function useCreator(): CreatorApi {
  const ctx = use(CreatorContext)
  if (!ctx) throw new Error('useCreator outside CreatorProvider')
  return ctx
}
