import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
const App = lazy(() => import('./App.jsx'))
const PublicTelemetryShare = lazy(() => import('./components/PublicTelemetryShare.jsx'))

const sharedMatch = window.location.pathname.match(/^\/shared\/telemetry\/([^/]+)$/)
const rootComponent = sharedMatch
  ? <PublicTelemetryShare token={decodeURIComponent(sharedMatch[1])} />
  : <App />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={null}>{rootComponent}</Suspense>
  </StrictMode>,
)
