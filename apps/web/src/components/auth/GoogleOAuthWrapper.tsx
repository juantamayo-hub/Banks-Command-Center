'use client'

import { GoogleOAuthProvider } from '@react-oauth/google'

export default function GoogleOAuthWrapper({ children }: { children: React.ReactNode }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

  // If no client ID is set, render children without the provider
  // (prevents crashes during development/build when env var is missing)
  if (!clientId) {
    return <>{children}</>
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      {children}
    </GoogleOAuthProvider>
  )
}
