'use client'

import { Component, type ReactNode } from 'react'

/** Si el chat de Alma falla, desaparece Alma; la página sigue funcionando. */
export default class AlmaBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[Alma] error en el chat', error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
