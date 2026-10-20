/**
 * Paridad de destinatarios: configuración nueva (resolveRecipients) vs lo que hacen HOY los flujos de n8n.
 *
 * Para cada banco × cada provincia de Pipedrive × (con / sin "Email bancario" en el deal) compara Para y CC.
 * El "oráculo" reimplementa la lógica actual de cada flujo con la hoja (scripts/data/…snapshot.json) y los mapas
 * que hoy están escritos en n8n (se leen en vivo por la API). Debe salir 0 diferencias antes de publicar un banco.
 *
 * Uso (desde apps/web):
 *   N8N_API_KEY=... npx jiti scripts/bank-config-parity.ts --seed /ruta/seed.json   # datos de la carga (sin BD)
 *   N8N_API_KEY=... npx jiti scripts/bank-config-parity.ts --db                     # datos de Supabase (.env.local)
 *   … [--bank deutsche_bank]
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  resolveRecipients,
  type BankConfig,
  type BankContact,
  type BlockedEmail,
  type Province,
} from '../src/lib/bankConfig'

const N8N = process.env.N8N_API_URL ?? 'https://huspy.app.n8n.cloud/api/v1'
const SNAPSHOT = path.join(__dirname, '..', '..', '..', 'scripts', 'data', 'red_flags_bancos_config_snapshot.json')
const OWNER = 'owner@bayteca.com'
const DEAL_EMAIL = 'gestor@banco-del-deal.es'

type Oracle = (provId: number, dealEmail: string) => { to: string[]; cc: string[] } | null

// ── Datos ────────────────────────────────────────────────────────────────────

async function n8nCode(wid: string, node: string): Promise<string> {
  const res = await fetch(`${N8N}/workflows/${wid}`, { headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY ?? '' } })
  if (!res.ok) throw new Error(`n8n ${wid}: ${res.status}`)
  const wf = await res.json()
  return wf.nodes.find((n: { name: string }) => n.name === node).parameters.jsCode as string
}

function jsObject(code: string, name: string): Record<string, string> {
  const m = code.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\{[\\s\\S]*?\\});`))
  if (!m) throw new Error(`No encuentro ${name}`)
  return Function(`return (${m[1]})`)() as Record<string, string>
}

async function loadData(): Promise<{ configs: BankConfig[]; contacts: BankContact[]; provinces: Province[]; blocked: BlockedEmail[] }> {
  const seedIdx = process.argv.indexOf('--seed')
  if (seedIdx > -1) return JSON.parse(fs.readFileSync(process.argv[seedIdx + 1], 'utf8'))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  const get = async (t: string) => {
    const r = await fetch(`${url}/rest/v1/${t}?select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!r.ok) throw new Error(`${t}: ${r.status} ${await r.text()}`)
    return r.json()
  }
  const [configs, contacts, provinces, blocked] = await Promise.all(
    ['bank_config', 'bank_contacts', 'provinces', 'blocked_emails'].map(get),
  )
  return { configs, contacts, provinces, blocked }
}

// ── Oráculo: lógica actual de cada flujo ─────────────────────────────────────

const split = (s: string) => s.split(/[,;]/).map((e) => e.trim()).filter((e) => e.includes('@'))
const letters = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')

async function buildOracles(): Promise<Record<string, Oracle>> {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
  const rows: string[][] = snap.contactos_banco
  const sheet = (bank: string) => rows.filter((r) => r[0] === bank)
  const prov = (r: string[]) => (r[6] ?? '').trim()

  const dCode = await n8nCode('vl1Ui6gm0RV6a3uO', 'RouterDecision1')
  const enumMap = jsObject(dCode, 'provinceEnumMap')        // id → nombre (igual en todos los flujos con provincias)
  const deutscheMap = jsObject(dCode, 'provinceEmailMap')
  const iCode = await n8nCode('p9WkjPl75vFBvrAW', 'Build Email Data')
  const iberProv = jsObject(iCode, 'provinciaMap')
  const iberOffice = jsObject(iCode, 'pMap')
  const lkCode = await n8nCode('uFgyDQGHWBVFdycN', 'PrepareEmail')
  const lkProv = jsObject(lkCode, 'provinceMap')

  const label = (id: number) => enumMap[String(id)] ?? String(id)
  const withOwner = (to: string[], cc: string[] = []) => ({ to, cc: [...cc, OWNER] })

  return {
    ruralnostra: () => withOwner(split(sheet('Ruralnostra')[0][1])),
    cr_teruel: () => withOwner(split(sheet('CR Teruel')[0][1])),
    cr_granada: () => withOwner(split(sheet('CR Granada')[0][1])),
    caixa_popular: () => withOwner(['mbotana@caixapopular.es']),
    myinvestor: () => withOwner(['hipotecas100@myinvestor.es']),
    pichincha: () => withOwner(['johanna.carrion@bancopichincha.es', 'laura.albuja@bancopichincha.es']),
    eurocajarural: (_p, deal) => (deal ? withOwner([deal]) : null),
    no_bank_fee: (_p, deal) => (deal ? withOwner([deal]) : null),
    unicaja: (_p, deal) => (deal ? withOwner([deal], deal === 'mclopezr@unicaja.es' ? ['lpenalver@unicaja.es'] : []) : null),
    ibercaja: (p, deal) => {
      const office = iberOffice[iberProv[String(p)] ?? String(p)] ?? ''
      return { to: ['solicitudesici@ibercajaconnect.es'], cc: deal ? [deal, OWNER] : [OWNER, office].filter(Boolean) }
    },
    deutsche_bank: (p, deal) => {
      const to = deal || deutscheMap[label(p)] || ''
      return to ? withOwner(split(to)) : null
    },
    hipotecas_com: (p, deal) => {
      if (deal) return withOwner([deal])
      const m = sheet('Hipotecas.com').find((r) => prov(r).toLowerCase() === label(p).toLowerCase())
      return m ? withOwner(split(m[1])) : null
    },
    cr_aragon: (p) => {
      const m = sheet('CR Aragón').find((r) => letters(prov(r)) === letters(label(p)))
      return m ? withOwner(split(m[1])) : null
    },
    cajamar: (p) => {
      const rs = sheet('Cajamar')
      const m = rs.find((r) => prov(r).toLowerCase() === label(p).toLowerCase()) ??
        rs.find((r) => prov(r).toLowerCase() === 'resto de españa')
      if (!m) return null
      return { to: split(m[1]), cc: prov(m).toLowerCase() === 'madrid' ? [OWNER] : [] }
    },
    cr_asturias: (p) => {
      const rs = sheet('CR Asturias')
      const m = rs.find((r) => prov(r).toLowerCase() === label(p).toLowerCase()) ??
        rs.find((r) => ['todas', 'all'].includes(prov(r).toLowerCase())) ??
        rs.find((r) => prov(r).toLowerCase() === 'resto de españa')
      return m ? withOwner(split(m[1])) : null
    },
    cr_del_sur: (p) => {
      const AND = ['Sevilla', 'Huelva', 'Cádiz', 'Málaga', 'Granada', 'Almería', 'Jaén', 'Córdoba']
      const key = AND.some((a) => label(p).toLowerCase().includes(a.toLowerCase())) ? 'andalucía' : 'resto de españa'
      const rs = sheet('CR del Sur')
      const m = rs.find((r) => prov(r).toLowerCase() === key) ?? rs.find((r) => prov(r).toLowerCase() === 'todas')
      return m ? withOwner(split(m[1])) : null
    },
    globalcaja: (p) => {
      const m = sheet('Globalcaja').find((r) => prov(r).toLowerCase() === label(p).toLowerCase())
      return m ? withOwner(split(m[1]), split(m[2] ?? '')) : null
    },
    laboral_kutxa: (p) => {
      const pl = String(lkProv[String(p)] ?? p).toLowerCase()
      const rs = sheet('Laboral Kutxa')
      const m = pl.includes('madrid') ? rs.find((r) => prov(r).toLowerCase().includes('madrid'))
        : pl.includes('valladolid') || pl.includes('palencia') ? rs.find((r) => prov(r).toLowerCase().includes('valladolid'))
          : rs.find((r) => prov(r).toLowerCase().includes('resto'))
      return m ? withOwner(split(m[1])) : null
    },
  }
}

// ── Comparación ──────────────────────────────────────────────────────────────

const key = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase()))].sort().join(',')

async function main() {
  const data = await loadData()
  const oracles = await buildOracles()
  const only = process.argv.includes('--bank') ? process.argv[process.argv.indexOf('--bank') + 1] : null
  const provIds = [...new Set(data.provinces.map((p) => p.pipedrive_option_id))].sort()
  let total = 0
  let diffs = 0

  for (const [slug, oracle] of Object.entries(oracles)) {
    if (only && slug !== only) continue
    const cfg = data.configs.find((c) => c.bank_slug === slug)
    if (!cfg) { console.log(`✗ ${slug}: sin bank_config`); diffs++; continue }
    let bankDiffs = 0
    const deals = slug === 'unicaja' ? ['', DEAL_EMAIL, 'mclopezr@unicaja.es'] : ['', DEAL_EMAIL]
    for (const p of provIds) {
      for (const deal of deals) {
        total++
        const want = oracle(p, deal)
        const got = resolveRecipients(cfg, data.contacts, data.provinces, data.blocked, {
          province: p, dealEmail: deal || null, ownerEmail: OWNER,
        })
        const gotSend = got.route === 'ok' ? { to: got.toEmails, cc: got.ccEmails } : null
        const same = want === null
          ? gotSend === null
          : gotSend !== null && key(want.to) === key(gotSend.to) && key(want.cc) === key(gotSend.cc)
        if (!same) {
          bankDiffs++
          if (bankDiffs <= 5) {
            console.log(`  ✗ ${slug} prov=${p} deal=${deal || '—'}\n      hoy:   ${want ? `TO ${key(want.to)} | CC ${key(want.cc)}` : 'NO ENVÍA'}\n      nuevo: ${gotSend ? `TO ${key(gotSend.to)} | CC ${key(gotSend.cc)}` : `NO ENVÍA (${got.route}: ${got.reason})`}`)
          }
        }
      }
    }
    diffs += bankDiffs
    console.log(`${bankDiffs ? '✗' : '✓'} ${slug}: ${bankDiffs} diferencias`)
  }
  console.log(`\n${total} combinaciones, ${diffs} diferencias`)
  process.exit(diffs ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(2) })
