'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

export default function UserMenu() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
  }, [])

  if (!user) return null

  const initials = (user.user_metadata?.full_name as string || user.email || '?')
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const avatarUrl = user.user_metadata?.avatar_url as string | undefined
  const displayEmail = user.email && user.email.length > 24
    ? user.email.slice(0, 22) + '...'
    : user.email

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2.5">
      {/* Avatar */}
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="h-7 w-7 rounded-full ring-1 ring-white/20 shrink-0"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-bayteca-green-dark text-[10px] font-semibold text-white/80 ring-1 ring-white/20 shrink-0">
          {initials}
        </div>
      )}

      {/* Email + sign out */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-white/70" title={user.email || ''}>
          {displayEmail}
        </p>
        <button
          onClick={handleSignOut}
          className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
        >
          Salir
        </button>
      </div>
    </div>
  )
}
