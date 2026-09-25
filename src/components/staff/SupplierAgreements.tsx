import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader } from '../Loader'
import { mirror, type RosterMember } from '../../lib/xanoMirror'
import { openSignedAgreement } from '../../lib/rosterOnboarding'
import { openSignedScheduleA } from '../../lib/songSchedule'

/**
 * A team's signed paperwork, for the Agreements tab on `/roster/:uuid` (Andy,
 * 24 Sep): the composer agreement, then a Schedule A for every song they have
 * written for us. A row with a signed copy opens it in a new tab.
 *
 * ⚠️ The Schedule As signed on BoldSign, before the new app, have no copy on
 * file: `schedule_a_link` is empty on all of them. They are listed, marked
 * "No copy on file", and do not open.
 */

type SongRow = {
  id: number
  track_title: string | null
  project: string | null
  brand: string | null
  schedule_a_status: string | null
  schedule_a_signed_at: string | null
  schedule_a_pdf_path: string | null
}

/** Exported so `/roster/:uuid` can load it with the page, not on the tab. */
export function useTeamSchedules(supplierId: number | undefined) {
  return useQuery({
    enabled: Number.isFinite(supplierId),
    queryKey: ['mirror', 'team-schedules', supplierId],
    queryFn: async (): Promise<SongRow[]> => {
      const { data, error } = await mirror
        .from('sequel_songs')
        .select('id, track_title, project, brand, schedule_a_status, schedule_a_signed_at, schedule_a_pdf_path')
        .eq('supplier_list_id', supplierId!)
        .order('id', { ascending: false })
      if (error) throw error
      return (data ?? []) as SongRow[]
    },
  })
}

const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
const when = (raw: string | null) => (raw ? date.format(new Date(raw)) : '')

type Row = {
  key: string
  title: string
  production: string
  signed: string
  status: string
  open?: () => Promise<string>
}

export function SupplierAgreements({ member: m }: { member: RosterMember }) {
  const songs = useTeamSchedules(m.id)
  const [note, setNote] = useState<string | null>(null)

  if (songs.isPending) {
    return (
      <Loader />
    )
  }
  if (songs.error) return <p className="form-error px-8 py-4">{songs.error.message}</p>

  const caStatus = m.has_agreement
    ? 'Signed'
    : m.agreement_stage === 'awaiting_sequel'
      ? 'To sign (Sequel)'
      : m.agreement_stage === 'awaiting_composer'
        ? 'Sent'
        : m.ca_status === 'Complete'
          ? 'Complete, no copy on file'
          : 'Not requested'

  const rows: Row[] = [
    {
      key: 'ca',
      title: 'Composer Agreement',
      production: '',
      signed: when(m.ca_signed_at),
      status: caStatus,
      open: m.has_agreement ? () => openSignedAgreement(m.id) : undefined,
    },
    ...songs.data.map((s) => ({
      key: `song-${s.id}`,
      title: `Schedule A: ${s.track_title || 'Untitled'}`,
      production: [s.brand, s.project].filter(Boolean).join(' / '),
      signed: when(s.schedule_a_signed_at),
      status:
        s.schedule_a_status === 'Complete' && !s.schedule_a_pdf_path
          ? 'Complete, no copy on file'
          : s.schedule_a_status || '',
      open: s.schedule_a_pdf_path ? () => openSignedScheduleA(s.id) : undefined,
    })),
  ]

  const open = async (row: Row) => {
    if (!row.open) return
    setNote(null)
    // Opened before the await, so the browser does not block it.
    const tab = window.open('about:blank', '_blank')
    try {
      const url = await row.open()
      if (tab) tab.location.href = url
    } catch (e) {
      tab?.close()
      setNote((e as Error).message)
    }
  }

  return (
    <>
      {note && <p className="form-error px-8 pb-4">{note}</p>}
      <div className="project-row project-row-agreement is-head">
        <span className="project-list-head-cell">Document</span>
        <span className="project-list-head-cell">Brand / Production</span>
        <span className="project-list-head-cell">Signed</span>
        <span className="project-list-head-cell">Status</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.key}
          role={r.open ? 'button' : undefined}
          tabIndex={r.open ? 0 : undefined}
          onClick={() => void open(r)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void open(r)
          }}
          className={`project-row project-row-agreement${r.open ? ' is-openable' : ' is-static'}`}
        >
          <span className="row-title">{r.title}</span>
          <span className="row-field">{r.production}</span>
          <span className="row-field">{r.signed}</span>
          <span className="row-field">{r.status}</span>
        </div>
      ))}
    </>
  )
}
