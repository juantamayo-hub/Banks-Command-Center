/**
 * GET /api/health/offers
 *
 * Datos para la revisión diaria automática (n8n "OFFERS · Revisión diaria con IA").
 * Solo lectura. Requiere cabecera x-offers-secret = OFFERS_API_SECRET.
 *
 * Devuelve:
 *  - responses: respuestas bancarias de las últimas 24 h por banco + cola de atención
 *  - kutxabank: envíos aprobados, con documentos faltantes
 *  - platform: envíos por plataforma pendientes
 *  - misplaced: deals bancarios (título de banco) en el pipeline de Opportunity (6)
 *    modificados en las últimas 48 h — síntoma de automatizaciones que mueven de pipeline
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { RESPONSE_BANKS } from '@/lib/bankResponses'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BANK_PREFIXES = RESPONSE_BANKS.map((b) => b.name.toLowerCase()).concat(['caixa', 'unicaja', 'ing'])

function looksLikeBankDeal(title: string): boolean {
  const t = title.toLowerCase().replace(/^[^a-z0-9]+/, '')
  return BANK_PREFIXES.some((p) => t.startsWith(p + ' ') || t.startsWith(p + '-') || t.startsWith(p + '🏠'))
}

export async function GET(req: Request) {
  const secret = process.env.OFFERS_API_SECRET
  if (!secret || req.headers.get('x-offers-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createAdminClient()
  const since24 = new Date(Date.now() - 24 * 3600_000).toISOString()

  const [summary, attention, kutxa, platform] = await Promise.all([
    supabase.rpc('bank_responses_summary', { p_since: since24 }),
    supabase
      .from('bank_responses')
      .select('bank_slug, classification, status, match_status, subject, error_step, error_message, received_at, bank_deal_id')
      .neq('status', 'resolved')
      .or('status.in.(error,manual_review),match_status.neq.matched')
      .order('received_at', { ascending: false })
      .limit(25),
    supabase
      .from('kutxabank_submissions')
      .select('deal_id, nombre_cliente, missing_docs, rastreator_status, updated_at')
      .eq('rastreator_status', 'approved')
      .is('dismissed_at', null),
    supabase
      .from('platform_dispatches')
      .select('*', { count: 'exact', head: true })
      .is('sent_at', null)
      .is('dismissed_at', null),
  ])

  // Deals bancarios en el pipeline de Opportunity modificados en las últimas 48 h
  let misplaced: Array<{ id: number; title: string; stage_id: number; status: string; update_time: string }> = []
  let misplacedError: string | null = null
  const token = process.env.PIPEDRIVE_API_TOKEN
  if (token) {
    try {
      const res = await fetch(
        `https://api.pipedrive.com/v1/pipelines/6/deals?limit=500&sort=update_time%20DESC&api_token=${token}`,
        { cache: 'no-store' }
      )
      const json = await res.json()
      const cutoff = Date.now() - 48 * 3600_000
      misplaced = ((json?.data ?? []) as Array<{ id: number; title: string; stage_id: number; status: string; update_time: string }>)
        .filter((d) => Date.parse(d.update_time.replace(' ', 'T') + 'Z') > cutoff && looksLikeBankDeal(d.title))
        .map(({ id, title, stage_id, status, update_time }) => ({ id, title, stage_id, status, update_time }))
    } catch (e) {
      misplacedError = e instanceof Error ? e.message : 'error'
    }
  }

  const kutxaRows = kutxa.data ?? []
  return NextResponse.json({
    generated_at: new Date().toISOString(),
    responses: {
      last24h_by_bank: summary.data ?? [],
      attention_open: attention.data ?? [],
      error: summary.error?.message ?? attention.error?.message ?? null,
    },
    kutxabank: {
      approved: kutxaRows.length,
      approved_with_missing_docs: kutxaRows.filter((r) => (r.missing_docs ?? []).length > 0),
    },
    platform: { pending_dispatches: platform.count ?? null },
    misplaced_bank_deals_in_opportunity: misplaced,
    misplaced_error: misplacedError,
  })
}
