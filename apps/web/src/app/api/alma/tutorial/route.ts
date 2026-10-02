/**
 * GET /api/alma/tutorial — vídeo corto (GIF) de «Cómo usarme».
 * Sale con datos reales de clientes, así que NO va en /public: solo lo ve quien tiene acceso a Alma.
 */

import { readFile } from 'fs/promises'
import path from 'path'
import { almaAuth } from '@/lib/alma/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const who = await almaAuth(req)
  if (!who.ok) return who.response
  const gif = await readFile(path.join(process.cwd(), 'private', 'alma-tutorial.gif'))
  return new Response(new Uint8Array(gif), {
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'private, max-age=3600' },
  })
}
