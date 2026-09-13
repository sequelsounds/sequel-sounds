import type { Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import SequelLogo from '../components/SequelLogo'
import CompositionReview from '../components/viewer/CompositionReview'
import SignInGate, { ProfileForm } from '../components/viewer/SignInGate'
import StandardPlaylist from '../components/viewer/StandardPlaylist'
import SyncSession from '../components/viewer/SyncSession'
import { useSession } from '../lib/auth'
import { useIsStaff } from '../lib/staff'
import {
  loadIdentity,
  useComments,
  useGate,
  useLogEvent,
  useRegister,
  useTheme,
  useViewer,
  useViewerPlaylist,
  useViewerProfile,
  viewerClient,
  ViewerContext,
  type Gate,
  type Identity,
} from '../lib/viewer'
import { ViewerPlayerProvider, type ViewerPlayable } from '../lib/viewerPlayer'

/**
 * A playlist, for whoever holds its link.
 *
 * Keyed on the token so moving between two links rebuilds the page — every
 * query, the player and the identity belong to one link.
 */
export default function SharedPlaylistRoute() {
  const { token = '' } = useParams()
  return <SharedPlaylist key={token} token={token} />
}

function SharedPlaylist({ token }: { token: string }) {
  const session = useSession()
  const gate = useGate(token)

  useEffect(() => {
    document.title = gate.data ? `Sequel | ${gate.data.name}` : 'Sequel'
  }, [gate.data])

  if (session === undefined || gate.isPending) return <Holding />
  if (gate.error || !gate.data) return <Dead />
  if (gate.data.require_sign_in && !session)
    return <SignInGate gate={gate.data} />
  if (session)
    return <Profiled session={session} gate={gate.data} token={token} />
  return <ViewerPage token={token} session={null} profile={null} />
}

type Profile = { name: string; email: string } | null

/** A signed-in viewer answers the once-only questions before the page. Staff skip them. */
function Profiled({
  session,
  gate,
  token,
}: {
  session: Session
  gate: Gate
  token: string
}) {
  const staff = useIsStaff()
  const profile = useViewerProfile(session.user.id)
  if (staff.isPending || profile.isPending) return <Holding />
  if (!staff.data && !profile.data)
    return <ProfileForm session={session} gate={gate} />
  return (
    <ViewerPage
      token={token}
      session={session}
      profile={
        profile.data
          ? { name: profile.data.name, email: profile.data.email }
          : null
      }
    />
  )
}

function ViewerPage({
  token,
  session,
  profile,
}: {
  token: string
  session: Session | null
  profile: Profile
}) {
  const client = useMemo(() => viewerClient(token), [token])
  const as = session?.user.id ?? 'anon'
  const ctx = useMemo(() => ({ token, client, as }), [token, client, as])
  return (
    <ViewerContext value={ctx}>
      <Loaded profile={profile} />
    </ViewerContext>
  )
}

function Loaded({ profile }: { profile: Profile }) {
  const { token } = useViewer()
  const playlist = useViewerPlaylist()
  const theme = useTheme()
  const comments = useComments(playlist.data?.id ?? null)
  const log = useLogEvent()
  const register = useRegister()
  const registerRef = useRef(register)
  const [identity, setIdentity] = useState<Identity | null>(() =>
    loadIdentity(token),
  )
  const identityRef = useRef(identity)
  useEffect(() => {
    registerRef.current = register
    identityRef.current = identity
  })

  // A signed-in viewer is registered from their profile without being
  // asked; the row is what their notes and plays are attributed to.
  useEffect(() => {
    if (!profile || !playlist.data) return
    const have = identityRef.current
    if (have && have.email === profile.email) return
    registerRef.current
      .mutateAsync({ name: profile.name, email: profile.email })
      .then(setIdentity)
      .catch(() => undefined)
  }, [profile, playlist.data])

  // One view per visit.
  const viewed = useRef(false)
  useEffect(() => {
    if (!playlist.data || viewed.current) return
    viewed.current = true
    log({
      playlistId: playlist.data.id,
      kind: 'view',
      viewerId: identityRef.current?.viewerId,
    })
  }, [playlist.data, log])

  if (playlist.isPending || theme.isPending) return <Holding />
  if (playlist.error || !playlist.data) return <Dead />
  const data = playlist.data

  const onPlayed = (track: ViewerPlayable, seconds: number, position: number) =>
    log({
      playlistId: data.id,
      kind: 'play',
      trackId: track.id,
      viewerId: identityRef.current?.viewerId,
      duration: seconds,
      position,
    })

  const page = {
    playlist: data,
    theme: theme.data ?? null,
    comments: comments.data ?? [],
    identity,
    onIdentity: setIdentity,
  }

  return (
    <ViewerPlayerProvider token={token} onPlayed={onPlayed}>
      {data.kind === 'sync' ? (
        <SyncSession {...page} />
      ) : data.kind === 'composition' ? (
        <CompositionReview {...page} />
      ) : (
        <StandardPlaylist {...page} />
      )}
    </ViewerPlayerProvider>
  )
}

function Holding() {
  return (
    <div className="surface-light flex min-h-screen items-center justify-center">
      <SequelLogo />
    </div>
  )
}

function Dead() {
  return (
    <div className="surface-light flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <SequelLogo />
      <h1 className="font-title text-[2rem] font-normal uppercase">
        Link not found
      </h1>
      <p className="max-w-sm text-sm text-sequel-mid">
        This link has been withdrawn, or it was never right. Ask whoever sent it
        for another.
      </p>
    </div>
  )
}
