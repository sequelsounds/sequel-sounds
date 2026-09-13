import { useState } from 'react'
import type { Tables } from '../../lib/database.types'
import {
  EMPTY_THEME,
  useBrandPreset,
  useThemeActions,
  type PlaylistDetail,
  type ThemeFields,
} from '../../lib/queries'

const COLOURS: {
  key: 'background_color' | 'text_color' | 'accent_color'
  label: string
  fallback: string
}[] = [
  { key: 'background_color', label: 'Background', fallback: '#f1f0ee' },
  { key: 'text_color', label: 'Text', fallback: '#372b29' },
  { key: 'accent_color', label: 'Accent', fallback: '#372b29' },
]

const HEX = /^#[0-9a-f]{6}$/i

function fields(
  t: Tables<'playlist_themes'> | Tables<'theme_presets'>,
): ThemeFields {
  return {
    logo_url: t.logo_url,
    background_url: t.background_url,
    background_color: t.background_color,
    text_color: t.text_color,
    accent_color: t.accent_color,
    heading: 'heading' in t ? t.heading : null,
  }
}

/**
 * What the viewer page wears.
 *
 * Themes follow the brand: a preset named for the brand dresses every
 * playlist on that brand's projects, and this panel is where one is made
 * — dress this playlist, then save it as the brand's. A playlist can also
 * keep a theme of its own, which wins over the preset field by field.
 * The colours are typed as hex so what is saved is what a browser reads,
 * and the picker beside each field is only a way of typing one.
 */
export default function ThemePanel({
  playlist,
  onClose,
}: {
  playlist: PlaylistDetail
  onClose: () => void
}) {
  const brand = playlist.projects_mirror?.brand?.trim() || null
  const preset = useBrandPreset(brand)
  const own = playlist.playlist_themes
  const actions = useThemeActions()

  // Nothing typed yet shows whatever the page is wearing now; an edit
  // takes over from there. Deriving rather than copying means a preset
  // that arrives after the panel opened still shows through.
  const base: ThemeFields = own
    ? fields(own)
    : preset.data
      ? fields(preset.data)
      : EMPTY_THEME
  const [edited, setEdited] = useState<ThemeFields | null>(null)
  const form = edited ?? base
  const set = (patch: Partial<ThemeFields>) => setEdited({ ...form, ...patch })

  const source = own
    ? 'This playlist wears a theme of its own.'
    : preset.data
      ? `Wearing the ${preset.data.brand ?? preset.data.name} preset.`
      : brand
        ? `No preset for ${brand} yet — Sequel's own colours.`
        : 'Not on a project — Sequel’s own colours.'

  const busy =
    actions.saveTheme.isPending ||
    actions.savePreset.isPending ||
    actions.clearTheme.isPending
  const error =
    actions.saveTheme.error ??
    actions.savePreset.error ??
    actions.clearTheme.error

  const bg = HEX.test(form.background_color ?? '')
    ? form.background_color!
    : '#f1f0ee'
  const fg = HEX.test(form.text_color ?? '') ? form.text_color! : '#372b29'
  const accent = HEX.test(form.accent_color ?? '') ? form.accent_color! : fg

  return (
    <div className="border-t border-sequel-line px-[18px] py-3 text-[13px]">
      <div className="mb-2 flex items-center justify-between text-sequel-mid">
        <span>Theme</span>
        <button type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p className="mb-3 text-sequel-mid">{source}</p>

      {/* A swatch of the page: its ground, its text, its accent, its logo. */}
      <div
        className="mb-3 flex h-14 items-center justify-between px-3"
        style={{
          backgroundColor: bg,
          color: fg,
          backgroundImage: form.background_url
            ? `url("${form.background_url}")`
            : undefined,
          backgroundSize: 'cover',
        }}
      >
        {form.logo_url ? (
          <img
            src={form.logo_url}
            alt=""
            className="h-6 w-auto max-w-[8rem] object-contain"
          />
        ) : (
          <span className="font-title uppercase">Sequel</span>
        )}
        <span className="text-xs" style={{ color: accent }}>
          {form.heading || playlist.name}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {COLOURS.map((c) => (
          <label
            key={c.key}
            className="grid grid-cols-[5rem_1.75rem_1fr] items-center gap-2"
          >
            <span className="text-sequel-mid">{c.label}</span>
            <input
              type="color"
              aria-label={`${c.label} colour`}
              value={HEX.test(form[c.key] ?? '') ? form[c.key]! : c.fallback}
              onChange={(e) => set({ [c.key]: e.target.value })}
              className="h-7 w-7 cursor-pointer border border-sequel-line bg-transparent p-0"
            />
            <input
              className="field-boxed py-1! font-mono text-xs!"
              placeholder={c.fallback}
              value={form[c.key] ?? ''}
              onChange={(e) => set({ [c.key]: e.target.value.trim() || null })}
            />
          </label>
        ))}
        <label className="grid grid-cols-[5rem_1fr] items-center gap-2">
          <span className="text-sequel-mid">Logo URL</span>
          <input
            className="field-boxed py-1! text-xs!"
            placeholder="https://…/logo.svg"
            value={form.logo_url ?? ''}
            onChange={(e) => set({ logo_url: e.target.value.trim() || null })}
          />
        </label>
        <label className="grid grid-cols-[5rem_1fr] items-center gap-2">
          <span className="text-sequel-mid">Background</span>
          <input
            className="field-boxed py-1! text-xs!"
            placeholder="https://…/image.jpg (optional)"
            value={form.background_url ?? ''}
            onChange={(e) =>
              set({ background_url: e.target.value.trim() || null })
            }
          />
        </label>
        <label className="grid grid-cols-[5rem_1fr] items-center gap-2">
          <span className="text-sequel-mid">Heading</span>
          <input
            className="field-boxed py-1! text-xs!"
            placeholder="Above the title (optional)"
            value={form.heading ?? ''}
            onChange={(e) => set({ heading: e.target.value || null })}
          />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn btn-tool btn-dark"
          disabled={busy}
          onClick={() =>
            actions.saveTheme.mutate(
              { playlistId: playlist.id, theme: form },
              { onSuccess: () => setEdited(null) },
            )
          }
        >
          Save for this playlist
        </button>
        <button
          type="button"
          className="btn btn-tool btn-outline"
          disabled={busy || !brand}
          title={
            brand
              ? `Every ${brand} playlist wears this`
              : 'Attach the playlist to a project first'
          }
          onClick={() =>
            brand &&
            actions.savePreset.mutate(
              { playlistId: playlist.id, brand, theme: form },
              { onSuccess: () => setEdited(null) },
            )
          }
        >
          Save as {brand ?? 'brand'} preset
        </button>
        {own && (
          <button
            type="button"
            className="btn btn-tool btn-quiet"
            disabled={busy}
            onClick={() =>
              actions.clearTheme.mutate(playlist.id, {
                onSuccess: () => setEdited(null),
              })
            }
          >
            Use the brand's instead
          </button>
        )}
        {edited && (
          <button
            type="button"
            className="btn btn-tool btn-quiet"
            onClick={() => setEdited(null)}
          >
            Discard changes
          </button>
        )}
      </div>
      {error && <p className="form-error mt-2">{error.message}</p>}
    </div>
  )
}
