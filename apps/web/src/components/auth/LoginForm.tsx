'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const GOOGLE_ICON = (
  <svg width="20" height="20" viewBox="0 0 48 48">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.01 24.01 0 0 0 0 21.56l7.98-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
)

/* Light ray directions from keyhole */
const RAYS = [
  { x2: 120, y2: 108 },
  { x2: 102, y2: 115 },
  { x2: 138, y2: 115 },
  { x2: 96, y2: 136 },
  { x2: 144, y2: 136 },
  { x2: 105, y2: 155 },
  { x2: 135, y2: 155 },
  { x2: 120, y2: 158 },
]

/* Stars in the sky area */
const STARS = [
  { cx: 25, cy: 22, r: 1.2, dur: '3s', delay: '1.8s' },
  { cx: 65, cy: 12, r: 1, dur: '2.5s', delay: '2.2s' },
  { cx: 175, cy: 15, r: 1.3, dur: '3.2s', delay: '2s' },
  { cx: 215, cy: 28, r: 1, dur: '2.8s', delay: '2.5s' },
  { cx: 140, cy: 8, r: 0.8, dur: '2.6s', delay: '1.9s' },
  { cx: 48, cy: 42, r: 0.9, dur: '3.4s', delay: '2.3s' },
  { cx: 200, cy: 48, r: 1.1, dur: '2.9s', delay: '2.1s' },
]

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void
          renderButton: (element: HTMLElement, config: Record<string, unknown>) => void
          prompt: () => void
        }
      }
    }
  }
}

export default function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [gsiReady, setGsiReady] = useState(false)
  const googleBtnRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(
    searchParams.get('error') === 'domain_not_allowed'
      ? 'Solo se permiten cuentas @huspy.io y @bayteca.com'
      : null
  )

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId) return

    async function handleCredentialResponse(response: { credential: string }) {
      setLoading(true)
      setError(null)
      try {
        const supabase = createClient()
        const { error: authError } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: response.credential,
        })
        if (authError) {
          console.error('Supabase auth error:', authError.message)
          setError('Error al iniciar sesión. Inténtalo de nuevo.')
          setLoading(false)
          return
        }
        router.push('/dashboard')
        router.refresh()
      } catch {
        setError('Error al iniciar sesión. Inténtalo de nuevo.')
        setLoading(false)
      }
    }

    function initGsi() {
      if (!window.google?.accounts?.id) return false
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      })
      if (googleBtnRef.current) {
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          type: 'standard',
          size: 'large',
          width: 400,
          theme: 'filled_black',
        })
      }
      setGsiReady(true)
      return true
    }

    if (initGsi()) return
    const interval = setInterval(() => {
      if (initGsi()) clearInterval(interval)
    }, 200)
    return () => clearInterval(interval)
  }, [router])

  function handleClick() {
    const btn = googleBtnRef.current?.querySelector('div[role="button"]') as HTMLElement | null
    if (btn) btn.click()
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden flex items-center justify-center"
      style={{ background: 'linear-gradient(160deg, #1B4332 0%, #122d22 50%, #0a1a14 100%)' }}
    >
      {/* Floating orbs */}
      <div className="animate-orb-1 pointer-events-none absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full opacity-25"
        style={{ background: 'radial-gradient(circle, #52976e 0%, transparent 65%)' }}
      />
      <div className="animate-orb-2 pointer-events-none absolute -bottom-48 -right-48 h-[700px] w-[700px] rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, #2D6A4F 0%, transparent 65%)' }}
      />
      <div className="animate-orb-3 pointer-events-none absolute top-1/4 right-[20%] h-[500px] w-[500px] rounded-full opacity-15"
        style={{ background: 'radial-gradient(circle, #7dab92 0%, transparent 60%)' }}
      />
      <div className="animate-orb-4 pointer-events-none absolute bottom-1/4 left-[20%] h-[450px] w-[450px] rounded-full opacity-[0.12]"
        style={{ background: 'radial-gradient(circle, #40916c 0%, transparent 65%)' }}
      />

      {/* Glass card */}
      <div className="animate-card-glow relative z-10 w-full max-w-md mx-4 rounded-2xl border border-white/[0.12] px-10 pt-8 pb-10 overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.08)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
      >
        {/* Shimmer line */}
        <div className="absolute top-0 left-0 right-0 h-[1px] overflow-hidden">
          <div className="animate-shimmer h-full w-1/2"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(82,151,110,0.5), transparent)' }}
          />
        </div>

        {/* ═══ HOUSE + KEY SVG ANIMATION ═══ */}
        <div className="flex justify-center mb-4">
          <svg viewBox="0 0 240 175" className="w-56 h-44" fill="none" xmlns="http://www.w3.org/2000/svg">

            {/* ── Stars ── */}
            {STARS.map((s, i) => (
              <circle key={`star-${i}`} cx={s.cx} cy={s.cy} r={s.r}
                fill="rgba(255,255,255,0.5)"
                style={{ animation: `twinkle ${s.dur} ease-in-out ${s.delay} infinite` }}
              />
            ))}

            {/* ── Roof ── */}
            <path d="M30,78 L120,16 L210,78"
              stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              className="login-draw" style={{ '--len': 220 } as React.CSSProperties}
            />

            {/* ── Left wall ── */}
            <line x1="42" y1="78" x2="42" y2="160"
              stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round"
              className="login-draw" style={{ '--len': 82, animationDelay: '0.1s' } as React.CSSProperties}
            />

            {/* ── Right wall ── */}
            <line x1="198" y1="78" x2="198" y2="160"
              stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round"
              className="login-draw" style={{ '--len': 82, animationDelay: '0.15s' } as React.CSSProperties}
            />

            {/* ── Ground ── */}
            <line x1="28" y1="160" x2="212" y2="160"
              stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round"
              className="login-draw" style={{ '--len': 184, animationDelay: '0.2s' } as React.CSSProperties}
            />

            {/* ── Left window frame ── */}
            <rect x="56" y="92" width="32" height="28" rx="2"
              stroke="rgba(255,255,255,0.2)" strokeWidth="1"
              className="login-draw" style={{ '--len': 120, animationDelay: '0.3s' } as React.CSSProperties}
            />
            {/* Left window crossbars */}
            <line x1="72" y1="92" x2="72" y2="120"
              stroke="rgba(255,255,255,0.12)" strokeWidth="0.8"
              className="login-draw" style={{ '--len': 28, animationDelay: '0.4s' } as React.CSSProperties}
            />
            <line x1="56" y1="106" x2="88" y2="106"
              stroke="rgba(255,255,255,0.12)" strokeWidth="0.8"
              className="login-draw" style={{ '--len': 32, animationDelay: '0.42s' } as React.CSSProperties}
            />
            {/* Left window glow */}
            <rect x="56" y="92" width="32" height="28" rx="2"
              fill="#52976e" fillOpacity="0"
              style={{ animation: 'window-light 1s ease-out 1.7s both' }}
            />

            {/* ── Right window frame ── */}
            <rect x="152" y="92" width="32" height="28" rx="2"
              stroke="rgba(255,255,255,0.2)" strokeWidth="1"
              className="login-draw" style={{ '--len': 120, animationDelay: '0.35s' } as React.CSSProperties}
            />
            {/* Right window crossbars */}
            <line x1="168" y1="92" x2="168" y2="120"
              stroke="rgba(255,255,255,0.12)" strokeWidth="0.8"
              className="login-draw" style={{ '--len': 28, animationDelay: '0.45s' } as React.CSSProperties}
            />
            <line x1="152" y1="106" x2="184" y2="106"
              stroke="rgba(255,255,255,0.12)" strokeWidth="0.8"
              className="login-draw" style={{ '--len': 32, animationDelay: '0.47s' } as React.CSSProperties}
            />
            {/* Right window glow */}
            <rect x="152" y="92" width="32" height="28" rx="2"
              fill="#52976e" fillOpacity="0"
              style={{ animation: 'window-light 1s ease-out 1.8s both' }}
            />

            {/* ── Door ── */}
            <path d="M104,160 L104,122 Q104,108 120,108 Q136,108 136,122 L136,160"
              stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              className="login-draw" style={{ '--len': 120, animationDelay: '0.4s' } as React.CSSProperties}
            />

            {/* ── Keyhole ── */}
            <circle cx="120" cy="136" r="5"
              stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"
              className="login-draw" style={{ '--len': 32, animationDelay: '0.5s' } as React.CSSProperties}
            />
            <line x1="120" y1="141" x2="120" y2="150"
              stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round"
              className="login-draw" style={{ '--len': 9, animationDelay: '0.55s' } as React.CSSProperties}
            />

            {/* ── Key (slides in from right, then turns clockwise) ── */}
            <g style={{
              transformOrigin: '120px 136px',
              animation: 'key-enter-turn 1.4s ease-in-out 0.7s both',
            }}>
              {/* Key bow (double ring) */}
              <circle cx="88" cy="136" r="9" stroke="#52976e" strokeWidth="1.5" />
              <circle cx="88" cy="136" r="4" stroke="#52976e" strokeWidth="1" />
              {/* Shaft */}
              <line x1="97" y1="136" x2="120" y2="136" stroke="#52976e" strokeWidth="1.5" />
              {/* Bits */}
              <line x1="113" y1="136" x2="113" y2="142" stroke="#52976e" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="117" y1="136" x2="117" y2="141" stroke="#52976e" strokeWidth="1.5" strokeLinecap="round" />
            </g>

            {/* ── Light rays from keyhole ── */}
            {RAYS.map((ray, i) => (
              <line key={`ray-${i}`} x1="120" y1="136" x2={ray.x2} y2={ray.y2}
                stroke="#52976e" strokeWidth="1" strokeLinecap="round"
                strokeDasharray="28" strokeDashoffset="28"
                style={{ animation: `ray-burst 0.8s ease-out ${1.65 + i * 0.04}s both` }}
              />
            ))}

            {/* ── Keyhole glow ── */}
            <circle cx="120" cy="136" r="4" fill="#52976e"
              style={{ animation: 'door-glow 1.2s ease-out 1.6s both' }}
            />

            {/* ── Small tree left ── */}
            <line x1="18" y1="160" x2="18" y2="145"
              stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeLinecap="round"
              className="login-draw" style={{ '--len': 15, animationDelay: '0.55s' } as React.CSSProperties}
            />
            <path d="M10,145 L18,130 L26,145"
              stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"
              className="login-draw" style={{ '--len': 46, animationDelay: '0.6s' } as React.CSSProperties}
            />

            {/* ── Small tree right ── */}
            <line x1="222" y1="160" x2="222" y2="142"
              stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeLinecap="round"
              className="login-draw" style={{ '--len': 18, animationDelay: '0.58s' } as React.CSSProperties}
            />
            <path d="M214,142 L222,125 L230,142"
              stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"
              className="login-draw" style={{ '--len': 50, animationDelay: '0.63s' } as React.CSSProperties}
            />

          </svg>
        </div>

        {/* ═══ FORM CONTENT (fades in after house animation) ═══ */}

        {/* Logo */}
        <div className="animate-fade-up flex justify-center mb-5"
          style={{ animationDelay: '2.1s' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bayteca-logo.svg" alt="Bayteca" className="h-6" />
        </div>

        {/* Title */}
        <h1 className="animate-fade-up text-center font-serif text-2xl font-medium tracking-tight text-white/95 mb-1.5"
          style={{ animationDelay: '2.25s' }}
        >
          Banks Command Center
        </h1>

        {/* Subtitle */}
        <p className="animate-fade-up text-center text-sm text-white/50 mb-8"
          style={{ animationDelay: '2.4s' }}
        >
          Inicia sesión con tu cuenta corporativa
        </p>

        {/* Error */}
        {error && (
          <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 text-center">
            {error}
          </div>
        )}

        {/* Hidden Google rendered button */}
        <div ref={googleBtnRef} className="absolute -left-[9999px] opacity-0 pointer-events-none" aria-hidden="true" />

        {/* Custom visible button */}
        <button
          onClick={handleClick}
          disabled={loading || !gsiReady}
          className="animate-fade-up flex w-full items-center justify-center gap-3 rounded-xl border border-white/[0.15] bg-white/[0.1] px-6 py-3.5 text-sm font-medium text-white transition-all duration-200 hover:bg-white/[0.18] hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(82,151,110,0.3)] disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          style={{ animationDelay: '2.55s' }}
        >
          {loading ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            GOOGLE_ICON
          )}
          {loading ? 'Conectando...' : 'Iniciar sesión con Google'}
        </button>

        {/* Footer */}
        <p className="animate-fade-up mt-6 text-center text-xs text-white/30"
          style={{ animationDelay: '2.7s' }}
        >
          Acceso restringido a @huspy.io y @bayteca.com
        </p>
      </div>
    </div>
  )
}
