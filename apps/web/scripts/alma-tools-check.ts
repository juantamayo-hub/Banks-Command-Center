/**
 * Comprobación determinista de las herramientas de Alma contra datos reales (sin llamar al modelo).
 * Uso: cd apps/web && npx tsx --env-file=.env.local scripts/alma-tools-check.ts
 */

import { runAlmaTool } from '../src/lib/alma/tools'

interface Case { name: string; tool: string; input: Record<string, unknown>; expect: (out: string) => boolean }

const has = (...words: string[]) => (out: string) => words.every((w) => out.toLowerCase().includes(w.toLowerCase()))

const CASES: Case[] = [
  { name: 'Buscar por nombre (Aida)', tool: 'buscar_cliente', input: { q: 'Aida Del Carmen' }, expect: has('383107') },
  { name: 'Buscar por nº de deal bancario (Andrés, Ibercaja 389502)', tool: 'buscar_cliente', input: { q: '389502' }, expect: has('389439') },
  { name: 'Andrés · Ibercaja enviado', tool: 'explicar_envio', input: { opportunity_id: 389439, banco: 'Ibercaja' }, expect: has('"motivo":"sent"') },
  // Jorge y Lorena se reenviaron el 1-oct con documentos más ligeros: Alma debe verlos enviados y con dossier < 25 MB
  { name: 'Jorge · Eurocaja enviado tras aligerar', tool: 'explicar_envio', input: { opportunity_id: 393188, banco: 'Eurocaja' }, expect: has('"motivo":"sent"', '"supera_limite_gmail_25mb":false') },
  { name: 'Lorena · No Bank Fee enviado tras aligerar', tool: 'explicar_envio', input: { opportunity_id: 387650, banco: 'No Bank Fee' }, expect: has('"motivo":"sent"') },
  { name: 'Aida · documentos (C003 presente)', tool: 'documentos_cliente', input: { opportunity_id: 383107 }, expect: has('"codigo":"C003"', '"presente":true') },
  { name: 'Tickets de Request Hub (Aida)', tool: 'tickets_cliente', input: { opportunity_id: 383107 }, expect: has('deals_consultados') },
  { name: 'Métricas de ayer', tool: 'metricas', input: { dias: 1 }, expect: has('envios_dossier', 'por_banco') },
  { name: 'Conocimiento · límites', tool: 'conocimiento', input: { tema: 'limites' }, expect: has('25 MB') },
]

async function main() {
  let ok = 0
  for (const c of CASES) {
    const t0 = Date.now()
    const out = await runAlmaTool(c.tool, c.input)
    const pass = out.ok && c.expect(out.content)
    if (pass) ok++
    console.log(`${pass ? '✅' : '❌'} ${c.name} (${Date.now() - t0} ms)`)
    if (!pass || process.env.VERBOSE) console.log('   ', out.content.slice(0, 1200).replace(/\n/g, ' '))
  }
  console.log(`\n${ok}/${CASES.length} correctas`)
  process.exit(ok === CASES.length ? 0 : 1)
}

void main()
