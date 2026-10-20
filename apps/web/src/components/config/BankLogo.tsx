import Image from 'next/image'
import { getBankAvatarColor, getBankLogo } from '@/lib/bankLogos'

/**
 * Logo del banco dentro de una "baldosa" cuadrada uniforme (fondo blanco + borde suave),
 * para que logos anchos, altos o pequeños se vean alineados. Sin logo: inicial sobre color.
 */
export default function BankLogo({ slug, name, size = 28 }: { slug: string; name: string; size?: number }) {
  const logo = getBankLogo(slug)
  const inner = Math.round(size * 0.72)
  if (logo) {
    return (
      <span
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-gray-200/80"
      >
        <Image src={logo} alt="" width={inner} height={inner} className="max-h-full max-w-full object-contain" style={{ width: inner, height: inner }} />
      </span>
    )
  }
  return (
    <span
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white ${getBankAvatarColor(slug)}`}
    >
      {name.charAt(0)}
    </span>
  )
}
