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
