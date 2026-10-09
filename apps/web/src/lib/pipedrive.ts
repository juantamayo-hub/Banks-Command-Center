/**
 * Server-side Pipedrive helpers.
 * Never import this in client components.
 */

const GDRIVE_FIELD_ID = 'c2ea08d72de437ee4957ff3807c48cebe7a1aa3e'

/**
 * Batch-fetch Google Drive links for a list of general deal IDs.
 * Returns a map { dealId → url | null }.
 * Failures per deal are silently ignored.
 */
export async function fetchGDriveLinks(
  dealIds: number[],
  token: string
): Promise<Record<number, string | null>> {
  if (dealIds.length === 0) return {}

  const results = await Promise.all(
    dealIds.map(async (id): Promise<[number, string | null]> => {
      try {
        const res = await fetch(
          `https://api.pipedrive.com/v1/deals/${id}?api_token=${token}`,
          { next: { revalidate: 60 } }
        )
        if (!res.ok) return [id, null]
        const json = await res.json()
        const url: unknown = json?.data?.[GDRIVE_FIELD_ID]
        return [
          id,
          typeof url === 'string' && url.startsWith('http') ? url : null,
        ]
      } catch {
        return [id, null]
      }
    })
  )

  return Object.fromEntries(results)
}

const GENERAL_DEAL_FIELD_ID = '71edfe1562e9e19d4c7d96d38548dd009d4b3601'

type PipedriveOwner = { id?: number; name?: string } | undefined

async function fetchDeal(id: number, token: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://api.pipedrive.com/v1/deals/${id}?api_token=${token}`, { next: { revalidate: 0 } })
  if (!res.ok) return null
  const json = await res.json()
  return (json?.data as Record<string, unknown>) ?? null
}

/**
 * Mención (@owner) para una nota en un deal bancario: owner del deal general vinculado
 * (mismo criterio que las notas manuales de /api/pipedrive/note) y, si no se puede
 * resolver, owner del propio deal bancario. Devuelve '' si falla: la nota se crea sin etiqueta.
 */
export async function ownerMention(bankDealId: number, token: string): Promise<string> {
  try {
    const bankDeal = await fetchDeal(bankDealId, token)
    const raw = bankDeal?.[GENERAL_DEAL_FIELD_ID]
    const linked = typeof raw === 'number' ? raw : (raw as { value?: number } | null)?.value
    const generalDeal = linked ? await fetchDeal(linked, token) : null
    const owner = (generalDeal?.user_id ?? bankDeal?.user_id) as PipedriveOwner
    if (!owner?.id || !owner.name) return ''
    return `<a href="/users/details/${owner.id}" data-mentions="${owner.id}:${owner.id}">@${owner.name}</a> `
  } catch {
    return ''
  }
}
