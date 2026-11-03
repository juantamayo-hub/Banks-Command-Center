/**
 * POST /api/dossiers/event — lo llama el generador de dossier de n8n (y NOTIFICATION si falla).
 *
 * Body: { event: 'created' | 'ready' | 'error', opportunity_id, dossier_key?, cliente?, owner?, importe?,
 *         link_dossier?, banks?: string[] (bancos de este dossier), error_type?, error_text?, execution_id?, test_mode? }
 *
 * 'ready': guarda el dossier y, por cada banco del deal con el interruptor en "Command Center", crea la línea de
 * envío y la lanza (en segundo plano). Los bancos que siguen en "Hoja" no se tocan: los reparte Apps Script como hoy.
 * Requiere cabecera x-offers-secret.
 */

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { hasOffersSecret } from '@/lib/auth/offersSecret'
import { createAdminClient } from '@/lib/supabase/server'
import { createRowsForDossier, dispatchRow, isTestMode } from '@/lib/dispatch/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const EVENTS = ['created', 'ready', 'error'] as const
const KEY_RE = /^[A-Z0-9_]{1,20}$/
const DRIVE_LINK_RE = /^https:\/\/(drive|docs)\.google\.com\//

const str = (v: unknown, max = 500): string | null => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
  return s ? s.slice(0, max) : null
}
const posInt = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null
}
const posNum = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.,]/g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function POST(req: Request) {
  if (!hasOffersSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let b: Record<string, unknown>
  try {
    const raw = await req.json()
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error()
    b = raw as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const event = EVENTS.find((e) => e === b.event)
  const opportunityId = posInt(b.opportunity_id)
  const dossierKey = (str(b.dossier_key, 20) ?? 'UNICO').toUpperCase().replace(/^TIPO\s*/, '')
  if (!event || !opportunityId || !KEY_RE.test(dossierKey)) {
    return NextResponse.json({ error: 'event (created|ready|error), opportunity_id y dossier_key válidos obligatorios' }, { status: 400 })
  }
  const testMode = b.test_mode === true || isTestMode()
  const db = await createAdminClient()

  const patch: Record<string, unknown> = {
    opportunity_id: opportunityId,
    dossier_key: dossierKey,
    execution_id: str(b.execution_id, 64),
    test_mode: testMode,
  }
  for (const k of ['cliente', 'owner'] as const) { const v = str(b[k]); if (v) patch[k] = v }
  // El enlace va en el correo al banco y en la web: solo Google Drive / Docs (nunca javascript:, phishing…)
  const link = str(b.link_dossier, 1000)
  if (link && DRIVE_LINK_RE.test(link)) patch.link_dossier = link
  const importe = posNum(b.importe); if (importe) patch.importe = importe
  if (event === 'created') patch.status = 'generating'
  if (event === 'ready') { patch.status = 'ready'; patch.error_type = null; patch.error_text = null }
  if (event === 'error') { patch.status = 'error'; patch.error_type = str(b.error_type, 100); patch.error_text = str(b.error_text, 2000) }

  const { data: dossier, error } = await db
    .from('dossiers')
    .upsert(patch, { onConflict: 'opportunity_id,dossier_key' })
    .select('id, link_dossier, cliente, owner, importe')
    .single()
  if (error || !dossier) {
    console.error('[dossiers/event] upsert', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  if (event !== 'ready') return NextResponse.json({ ok: true, dossier_id: dossier.id })

  const bankNames = Array.isArray(b.banks) ? (b.banks as unknown[]).map((x) => str(x, 80)).filter((x): x is string => !!x) : null
  try {
    const { results, toDispatch, banks } = await createRowsForDossier(db, {
      opportunity_id: opportunityId,
      dossier_id: dossier.id as string,
      link_dossier: (dossier.link_dossier as string | null) ?? null,
      cliente: (dossier.cliente as string | null) ?? null,
      owner: (dossier.owner as string | null) ?? null,
      importe: (dossier.importe as number | null) ?? null,
      bank_names: bankNames,
      test_mode: testMode,
    })
    // Envío en segundo plano: el generador recibe la respuesta enseguida
    if (toDispatch.length) {
      waitUntil(Promise.all(toDispatch.map((rowId) =>
        dispatchRow(db, { rowId, actor: 'auto:dossier_ready', source: 'auto', banks })
          .then((r) => { if (!r.ok) console.error('[dossiers/event] dispatch', rowId, r.code, r.error) })
          .catch((e) => console.error('[dossiers/event] dispatch', rowId, e)),
      )))
    }
    return NextResponse.json({ ok: true, dossier_id: dossier.id, test_mode: testMode, lines: results })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[dossiers/event] lines', msg)
    return NextResponse.json({ ok: false, dossier_id: dossier.id, error: 'No se pudieron crear las líneas de envío' }, { status: 502 })
  }
}
