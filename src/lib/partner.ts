const STORAGE_KEY = 'sequel.partner.v1'

export type Partner = {
  name: string
  email: string
  company: string
}

export const EMPTY_PARTNER: Partner = { name: '', email: '', company: '' }

/**
 * Who is dropping files, captured once per browser rather than per track.
 * Self-declared and unverified — the share token is the actual authorisation;
 * this is just so staff know who to reply to.
 */
export function loadPartner(): Partner {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_PARTNER
    const parsed = JSON.parse(raw) as Partial<Partner>
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      email: typeof parsed.email === 'string' ? parsed.email : '',
      company: typeof parsed.company === 'string' ? parsed.company : '',
    }
  } catch {
    // Private mode, disabled storage, or a corrupt value — just ask again.
    return EMPTY_PARTNER
  }
}

export function savePartner(partner: Partner): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(partner))
  } catch {
    // Not being able to remember them is not worth failing an upload over.
  }
}

export function isComplete(partner: Partner): boolean {
  return (
    partner.name.trim() !== '' &&
    partner.company.trim() !== '' &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(partner.email.trim())
  )
}
