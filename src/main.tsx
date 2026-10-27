import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// A render-time exception used to leave the window completely blank. Surface it instead.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          padding: 40,
          font: '13px/1.6 ui-monospace, Cascadia Mono, monospace',
          background: '#fbeee6',
          color: '#8a3b12',
          height: '100%',
          overflow: 'auto',
        }}
      >
        <h2 style={{ fontFamily: 'system-ui', fontSize: 18 }}>BibleReader failed to render</h2>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error?.stack ?? this.state.error)}</pre>
        <button onClick={() => location.reload()} style={{ marginTop: 16 }}>
          Reload
        </button>
      </div>
    )
  }
}

// Preload missing => every window.api call throws. Say so rather than rendering nothing.
if (typeof window !== 'undefined' && !('api' in window)) {
  document.getElementById('root')!.innerHTML =
    '<div style="padding:40px;font:14px/1.6 system-ui;color:#8a3b12;background:#fbeee6">' +
    '<h2>Preload script did not load</h2>' +
    '<p><code>window.api</code> is undefined, so the app cannot talk to the main process.</p>' +
    '<p>Check the terminal for a <code>[preload] ERROR</code> line.</p></div>'
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}
