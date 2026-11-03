/**
 * Autenticación de llamadas de n8n con la cabecera x-offers-secret (= OFFERS_API_SECRET).
 * Comparación en tiempo constante: este secreto permite crear envíos reales a bancos.
 */
import { timingSafeEqual } from 'crypto'

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function hasOffersSecret(req: Request): boolean {
  const secret = process.env.OFFERS_API_SECRET
  const got = req.headers.get('x-offers-secret')
  return !!secret && !!got && safeEqual(got, secret)
}
