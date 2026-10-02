/**
 * Equipo de Bank Ops: a quién acudir para cada tema y a quién puede escribir Alma por Slack
 * (siempre con confirmación de la persona que usa el chat). Mantener al día si cambian roles.
 */

export interface TeamMember {
  clave: string        // identificador corto para las herramientas
  nombre: string
  apodo: string
  rol: string
  temas: string[]      // de qué se encarga (para que Alma sepa a quién derivar)
  email: string
}

export const TEAM: TeamMember[] = [
  {
    clave: 'oscar',
    nombre: 'Oscar Sastre',
    apodo: 'Oscar',
    rol: 'Responsable de envíos de dossier a bancos',
    temas: ['envíos', 'hoja de envíos', 'dossieres', 'envíos por plataforma', 'Kutxabank'],
    email: 'oscar.sastre@bayteca.com',
  },
  {
    clave: 'flor',
    nombre: 'Florencia Fernández',
    apodo: 'Flor',
    rol: 'Responsable de ofertas (respuestas de los bancos)',
    temas: ['ofertas', 'respuestas de bancos', 'Requieren atención', 'rechazos', 'más información'],
    email: 'florencia.fernandez@bayteca.com',
  },
  {
    clave: 'silvia',
    nombre: 'Silvia Amigo',
    apodo: 'Silvia',
    rol: 'Jefa de Bank Ops',
    temas: ['prioridades del equipo', 'decisiones', 'escalados de negocio', 'autorizaciones'],
    email: 'silvia.amigo@mortgagedirectsl.com',
  },
  {
    clave: 'juanjo',
    nombre: 'Juan José Tamayo',
    apodo: 'Juanjo',
    rol: 'Desarrollador de las herramientas y automatizaciones de operaciones (Command Center, Request Hub, n8n, Apps Script)',
    temas: ['problemas técnicos', 'n8n', 'Supabase', 'Apps Script', 'sincronización', 'cambios de proceso'],
    email: 'juan.tamayo@huspy.io',
  },
  {
    clave: 'ceci',
    nombre: 'Cecilia Parent',
    apodo: 'Ceci',
    rol: 'Reclamaciones a bancos',
    temas: ['reclamaciones', 'bancos que no responden', 'seguimiento de expedientes atascados en el banco'],
    email: 'cecilia.parent@bayteca.com',
  },
]

export function findMember(q: string): TeamMember | undefined {
  const k = q.trim().toLowerCase()
  return TEAM.find((m) => m.clave === k || m.apodo.toLowerCase() === k || m.nombre.toLowerCase() === k || m.email === k || m.nombre.toLowerCase().startsWith(k))
}
