import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PublicTelemetryShare from './components/PublicTelemetryShare.jsx'

const sharedMatch = window.location.pathname.match(/^\/shared\/telemetry\/([^/]+)$/)
const rootComponent = sharedMatch
  ? <PublicTelemetryShare token={decodeURIComponent(sharedMatch[1])} />
  : <App />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {rootComponent}
  </StrictMode>,
)
