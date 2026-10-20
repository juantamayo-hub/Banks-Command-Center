import Image from 'next/image'
import { getBankAvatarColor, getBankLogo } from '@/lib/bankLogos'

/** Logo del banco (o inicial sobre color) — mismo criterio que métricas / ofertas. */
export default function BankLogo({ slug, name, size = 28 }: { slug: string; name: string; size?: number }) {
  const logo = getBankLogo(slug)
  if (logo) {
    return <Image src={logo} alt="" width={size} height={size} className="rounded object-contain" />
  }
  return (
    <span
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded text-xs font-bold text-white ${getBankAvatarColor(slug)}`}
    >
      {name.charAt(0)}
    </span>
  )
}
