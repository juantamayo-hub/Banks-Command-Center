import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth/requireAuth'

/**
 * Contadores de pendientes para las burbujas del menú lateral. Solo lectura (count head).
 * Cada contador replica el criterio de "pendiente" de su página:
 * - envios:     /dashboard?tab=pendientes (no enviados, sin perdidos/descartados, últimos 15 días, sin bancos de plataforma)
 * - plataforma: /dashboard/envios-plataforma ("Todos": platform_dispatches sin enviar ni descartar + Kutxabank aprobados)
 * - ofertas:    /dashboard/ofertas ("requieren atención" de los últimos 30 días)
 * - prestamos:  /dashboard/prestamos (falta documentación + error de envío)
 */

export const dynamic = 'force-dynamic'

const PENDING_CUTOFF_MS = 15 * 24 * 60 * 60 * 1000
const OFERTAS_DAYS = 30

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const supabase = await createAdminClient()

  const cutoff = new Date(Date.now() - PENDING_CUTOFF_MS).toISOString()
  const pendingAgeFilter = `timestamp_entry.gte.${cutoff},and(timestamp_entry.is.null,created_at.gte.${cutoff})`
  const ofertasSince = new Date(Date.now() - OFERTAS_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: noDispatchBanks } = await supabase.from('banks').select('id').eq('has_dispatch', false)
  const noDispatchIds = (noDispatchBanks ?? []).map((b) => b.id as string)

  let envios = supabase
    .from('sheet_rows')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'sent')
    .eq('pipedrive_lost', false)
    .eq('is_discarded', false)
    .or(pendingAgeFilter)
  if (noDispatchIds.length > 0) envios = envios.not('bank_id', 'in', `(${noDispatchIds.join(',')})`)

  const [enviosRes, platformRes, kutxaRes, ofertasRes, prestamosRes] = await Promise.all([
    envios,
    supabase.from('platform_dispatches').select('id', { count: 'exact', head: true }).is('sent_at', null).is('dismissed_at', null),
    supabase.from('kutxabank_submissions').select('id', { count: 'exact', head: true }).eq('rastreator_status', 'approved').is('dismissed_at', null),
    supabase
      .from('bank_responses')
      .select('id', { count: 'exact', head: true })
      .gte('received_at', ofertasSince)
      .neq('status', 'resolved')
      .or('status.in.(error,manual_review),match_status.neq.matched'),
    supabase.from('lender_submissions').select('id', { count: 'exact', head: true }).in('status', ['pending_docs', 'error']),
  ])

  // Un contador que falla se omite (sin burbuja) en lugar de mostrar un número falso
  const value = (r: { count: number | null; error: unknown }) => (r.error ? null : r.count ?? 0)
  const platform = platformRes.error || kutxaRes.error ? null : (platformRes.count ?? 0) + (kutxaRes.count ?? 0)

  return NextResponse.json(
    {
      envios: value(enviosRes),
      plataforma: platform,
      ofertas: value(ofertasRes),
      prestamos: value(prestamosRes),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
