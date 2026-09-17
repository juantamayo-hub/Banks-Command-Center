/**
 * Bank logo paths.
 * Only banks with actual logo files in /public/banks/ are mapped here.
 * For banks without logos, the UI falls back to an avatar with the first letter.
 */

const BANK_LOGOS: Record<string, string> = {
  abanca: '/banks/abanca.png',
  bankinter: '/banks/bankinter.png',
  caixa_popular: '/banks/caixa_popular.png',
  caixabank: '/banks/caixabank.png',
  cajamar: '/banks/cajamar.png',
  cr_aragon: '/banks/cr_aragon.png',
  cr_asturias: '/banks/cr_asturias.png',
  cr_del_sur: '/banks/cr_del_sur.png',
  cr_extremadura: '/banks/cr_extremadura.png',
  cr_granada: '/banks/cr_granada.png',
  cr_teruel: '/banks/cr_teruel.png',
  deutsche_bank: '/banks/deutsche_bank.png',
  eurocajarural: '/banks/eurocajarural.png',
  globalcaja: '/banks/globalcaja.png',
  ibercaja: '/banks/ibercaja.png',
  ing: '/banks/ing.png',
  kutxabank: '/banks/kutxabank.png',
  laboral_kutxa: '/banks/laboral_kutxa.png',
  myinvestor: '/banks/myinvestor.png',
  pichincha: '/banks/pichincha.png',
  ruralnostra: '/banks/ruralnostra.png',
  sabadell: '/banks/sabadell.png',
  santander: '/banks/santander.png',
  uci: '/banks/uci.png',
  unicaja: '/banks/unicaja.png',
}

export function getBankLogo(slug: string): string | null {
  return BANK_LOGOS[slug] ?? null
}

/** Color palette for bank letter avatars (deterministic by slug) */
const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-red-500',
  'bg-cyan-500',
  'bg-amber-500',
]

export function getBankAvatarColor(slug: string): string {
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) - hash + slug.charCodeAt(i)) | 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
