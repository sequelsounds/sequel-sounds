import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { NewProject } from '../components/staff/NewProject'
import { ProjectRowActions } from '../components/staff/RowActions'
import { useMe, useMyProjects, type Project } from '../lib/xanoMirror'

/**
 * Sequel Track's `/projects`, rebuilt from the page rather than from the data.
 *
 * It is "YOUR PROJECTS" literally: Track's get_staff_projects returns only the
 * projects the signed-in person supervises, minus the archived ones, newest
 * first. The four counters in the band are keyed on the pipeline-stage id —
 * 7 Complete, 8 Cancelled, 9 Archived, everything else open — and they follow
 * the search box, so searching an agency turns them into "how much have I got
 * on with them".
 *
 * The grid, the type and the hover are Webflow's dashboard_project_row; the
 * search matches the same way Track's does, anywhere in the row.
 */

/** Status ids that take a project out of the open count and the pipeline. */
const CLOSED = [7, 8, 9]
const isOpen = (p: Project) => p.status_id == null || !CLOSED.includes(p.status_id)

/** "£121,750" — whole pounds; the band has no room for pence. */
const pounds = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

function Counter({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export default function Projects() {
  const me = useMe()
  const projects = useMyProjects(me.isPending ? undefined : (me.data?.id ?? null))
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)

  // Track searches the serialised row, so any field matches — an agency, a
  // brand, a job number, a status. Matching the same way here keeps the
  // counters below honest: they are computed from whatever this returns.
  const rows = useMemo(() => {
    const all = projects.data ?? []
    const term = q.trim().toLowerCase()
    if (!term) return all
    return all.filter((p) => JSON.stringify(p).toLowerCase().includes(term))
  }, [projects.data, q])

  const open = rows.filter(isOpen)
  const pipeline = open.reduce((sum, p) => sum + (Number(p.pipeline_gbp) || 0), 0)

  return (
    <>
      <div className="header-band">
        <div className="page-eyebrow">Let&rsquo;s check in on&hellip;</div>
        <div className="title-row">
          <h1 className="page-title">Your projects</h1>
          <button
            type="button"
            className="btn btn-mono btn-outline"
            onClick={() => setAdding(true)}
          >
            + New Project
          </button>
        </div>
        <div className="page-subtitle">{me.data?.name ?? ' '}</div>
      </div>

      {adding && (
        <NewProject
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false)
            navigate(`/projects/${id}`)
          }}
        />
      )}

      <div className="tab-band">
        <div className="tab-band-search">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search projects"
            className="project-search"
          />
        </div>
        <div className="tab-band-divider" />
        <Counter label="Open" value={open.length} />
        <div className="tab-band-divider" />
        <Counter label="Complete" value={rows.filter((p) => p.status_id === 7).length} />
        <div className="tab-band-divider" />
        <Counter label="Cancelled" value={rows.filter((p) => p.status_id === 8).length} />
        <div className="tab-band-divider" />
        <Counter label="Pipeline" value={`£${pounds.format(pipeline)}`} />
      </div>

      <div className="project-list-grid project-list-head">
        <span className="project-list-head-cell">Title</span>
        <span className="project-list-head-cell">Brand</span>
        <span className="project-list-head-cell">Agency</span>
        <span className="project-list-head-cell">Job No.</span>
        <span className="project-list-head-cell">Status</span>
        <span className="project-list-head-cell">Service</span>
        <span className="project-list-head-cell text-center">Share</span>
        <span className="project-list-head-cell text-center">Delete</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {(projects.isPending || me.isPending) && (
          <div className="flex justify-center py-16">
            <Loader />
          </div>
        )}
        {projects.error && <p className="form-error px-8 py-4">{projects.error.message}</p>}
        {projects.data &&
          rows.map((p) => (
            <div
              key={p.id}
              className="project-list-grid project-list-row"
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              {/* 14 of the 241 projects carry no title at all — blank shells
                  made in Track. The id keeps them identifiable rather than
                  rendering an empty line you cannot click with confidence. */}
              <span className="project-list-cell" title={p.title ?? undefined}>
                {p.title ?? `Untitled (#${p.id})`}
              </span>
              <span className="project-list-cell" title={p.brand ?? undefined}>
                {p.brand}
              </span>
              {/* The client user's company, which is what Track shows here —
                  not the project's own client_agency. */}
              <span className="project-list-cell" title={p.client_user_company ?? undefined}>
                {p.client_user_company}
              </span>
              <span className="project-list-cell">{p.sequel_no}</span>
              <span className="project-list-cell">{p.stage}</span>
              <span className="project-list-cell">{p.service}</span>
              <ProjectRowActions id={p.id} />
            </div>
          ))}
        {projects.data && rows.length === 0 && (
          <p className="empty-note py-6">
            {q ? 'Nothing matches that search.' : 'No projects on this account.'}
          </p>
        )}
      </div>
    </>
  )
}
