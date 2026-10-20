/**
 * Autenticación de llamadas de n8n con la cabecera x-offers-secret (= OFFERS_API_SECRET).
 * Mismo criterio que /api/dossier/claim o /api/bank-responses (allí está inline).
 */
export function hasOffersSecret(req: Request): boolean {
  const secret = process.env.OFFERS_API_SECRET
  return !!secret && req.headers.get('x-offers-secret') === secret
}
