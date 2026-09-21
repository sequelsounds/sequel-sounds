import { useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  SIGNATURE_BOX,
  SIGNATURE_FONTS,
  typedSignaturePath,
  useMySignature,
  useSaveMySignature,
  type SignatureFontId,
  type SignatureKind,
} from '../../lib/signature'
import { useMe } from '../../lib/xanoMirror'

/**
 * The signature a staff user makes once and the app reuses — on release forms
 * now, and on anything else that needs signing later.
 *
 * Two ways in, ONE THING OUT: whether it is drawn with a pointer or typed in a
 * handwriting face, what gets stored is an SVG path in the 600x200 box. Nothing
 * downstream knows which route it came from, no font ships with the PDF, and a
 * face dropped from the list later does not change a signature already saved.
 *
 * ⚠️ YOU CAN ONLY SIGN FOR YOURSELF. `track_save_my_signature` takes no user
 * argument — it writes to the row matching auth.uid() and nothing else — so
 * there is no call in the app that puts one person's hand on another's
 * document. This page being yours is tidiness; that is the control.
 */

/** Points to a path. Straight segments rather than curves: a signature drawn at
 *  screen resolution already has plenty of points, and smoothing them invents
 *  strokes the person did not make. */
function toPath(strokes: { x: number; y: number }[][]) {
  const r = (n: number) => Math.round(n * 10) / 10
  return strokes
    .filter((s) => s.length > 0)
    .map((s) =>
      s.length === 1
        ? // A dot: a tiny segment, or it draws nothing at all.
          `M${r(s[0].x)} ${r(s[0].y)}L${r(s[0].x + 0.5)} ${r(s[0].y)}`
        : `M${s.map((p) => `${r(p.x)} ${r(p.y)}`).join('L')}`,
    )
    .join('')
}

type Mode = 'draw' | 'type'

export function SignaturePad() {
  const me = useMe()
  const saved = useMySignature()
  const save = useSaveMySignature()
  const svg = useRef<SVGSVGElement>(null)

  const [mode, setMode] = useState<Mode>('draw')
  const [strokes, setStrokes] = useState<{ x: number; y: number }[][]>([])
  const [drawing, setDrawing] = useState(false)
  const [typed, setTyped] = useState<string | null>(null)
  const [fontId, setFontId] = useState<SignatureFontId>(SIGNATURE_FONTS[0].id)
  const [error, setError] = useState<string | null>(null)

  const font = SIGNATURE_FONTS.find((f) => f.id === fontId) ?? SIGNATURE_FONTS[0]
  /** Their own name to start with, which is what they were going to type. */
  const name = typed ?? me.data?.name ?? ''

  /** Turning text into outlines is async — it fetches the font — so it is a
   *  query rather than an effect writing into state. */
  const typedPath = useQuery({
    enabled: mode === 'type' && name.trim() !== '',
    queryKey: ['typed-signature', name.trim(), font.file],
    queryFn: () => typedSignaturePath(name, font.file),
  })

  const drew = strokes.some((s) => s.length > 0)
  const stored = saved.data?.signature_path ?? null
  const kind: SignatureKind = mode === 'type' ? 'typed' : 'drawn'

  /** What is on screen, and what SAVE would store. */
  const candidate =
    mode === 'type' ? (typedPath.data ?? '') : drew ? toPath(strokes) : ''
  const shown = candidate || (mode === 'draw' ? stored : '')
  /** What is on screen is the new one if there is one, else the stored one —
   *  and each is filled or stroked according to what it actually is. */
  const shownKind: SignatureKind = candidate ? kind : (saved.data?.signature_kind ?? 'drawn')

  const at = useCallback((e: React.PointerEvent) => {
    const box = svg.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return {
      x: ((e.clientX - box.left) / box.width) * SIGNATURE_BOX.width,
      y: ((e.clientY - box.top) / box.height) * SIGNATURE_BOX.height,
    }
  }, [])

  const start = (e: React.PointerEvent) => {
    if (mode !== 'draw') return
    e.preventDefault()
    // Capture, or a stroke that leaves the box mid-flight never gets its
    // pointerup and the pad stays stuck drawing.
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setError(null)
    setDrawing(true)
    setStrokes((s) => [...s, [at(e)]])
  }

  const move = (e: React.PointerEvent) => {
    if (!drawing || mode !== 'draw') return
    e.preventDefault()
    const p = at(e)
    setStrokes((s) => {
      const last = s[s.length - 1]
      if (!last) return s
      const prev = last[last.length - 1]
      // Skip points closer than half a unit: they add bytes and no shape.
      if (prev && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5) return s
      return [...s.slice(0, -1), [...last, p]]
    })
  }

  const end = () => setDrawing(false)

  const note = () => {
    if (error) return error
    if (typedPath.error) return (typedPath.error as Error).message
    if (mode === 'type') return 'Type your name and pick a hand. It saves as a signature either way.'
    if (stored && !drew) return 'This goes on release forms you issue. Draw again to replace it.'
    return 'Sign in the box. It goes on release forms you issue, and on anything else that needs signing.'
  }

  return (
    <div className="sig-pad">
      <div className="am-label">Signature</div>

      <div className="sig-modes" role="tablist">
        {(['draw', 'type'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`sig-mode${mode === m ? ' is-on' : ''}`}
            onClick={() => {
              setMode(m)
              setError(null)
            }}
          >
            {m === 'draw' ? 'DRAW IT' : 'TYPE IT'}
          </button>
        ))}
      </div>

      <p className="sig-note">{note()}</p>

      {mode === 'type' && (
        <div className="sig-typed">
          <input
            type="text"
            className="am-input"
            aria-label="Name to write"
            placeholder="Your name"
            value={name}
            onChange={(e) => setTyped(e.target.value)}
          />
          {/* One hand so far. Adding another is a line in SIGNATURE_FONTS and a
              .ttf in public/fonts, so the picker earns its place already. */}
          {SIGNATURE_FONTS.length > 1 && (
            <select
              className="am-input"
              aria-label="Handwriting style"
              value={fontId}
              onChange={(e) => setFontId(e.target.value as SignatureFontId)}
            >
              {SIGNATURE_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <svg
        ref={svg}
        className={`sig-canvas${mode === 'draw' ? ' is-drawable' : ''}`}
        viewBox={`0 0 ${SIGNATURE_BOX.width} ${SIGNATURE_BOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Signature"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      >
        <line x1="40" y1="160" x2={SIGNATURE_BOX.width - 40} y2="160" className="sig-rule" />
        {/* Drawn strokes are a line and are stroked; letter outlines are shapes
            and are filled. Stroking the outlines would trace round every letter
            twice, which looks like a font, not a signature. */}
        {shown && <path d={shown} className={shownKind === 'typed' ? 'sig-ink-filled' : 'sig-ink'} />}
      </svg>

      <div className="sig-actions">
        <button
          type="button"
          className="btn btn-mono btn-outline"
          disabled={!candidate && !stored}
          onClick={() => {
            setStrokes([])
            setError(null)
            if (mode === 'type') setTyped('')
            if (!candidate && stored) {
              // Nothing made this visit, so CLEAR means remove the stored one.
              save.mutate({ path: null, kind: 'drawn' }, { onError: (e: Error) => setError(e.message) })
            }
          }}
        >
          CLEAR
        </button>
        <button
          type="button"
          className={`btn btn-mono btn-outline${candidate && !save.isPending ? '' : ' is-off'}`}
          disabled={!candidate || save.isPending}
          onClick={() => {
            if (!candidate) return
            save.mutate({ path: candidate, kind }, {
              onSuccess: () => setStrokes([]),
              onError: (e: Error) => setError(e.message),
            })
          }}
        >
          {save.isPending ? 'SAVING…' : 'SAVE SIGNATURE'}
        </button>
      </div>
    </div>
  )
}
