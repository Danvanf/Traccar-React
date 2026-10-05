import { useState } from 'react'
import ReportsWorkspace from './reports/ReportsWorkspace'

function VehicleStatsPanel({ baseUrl, traccarApi }) {
  const [reportsOpen, setReportsOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="vehicle-stats-launcher"
        onClick={() => setReportsOpen(true)}
        aria-label="Open vehicle reports"
        title="Open vehicle reports"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 19V5M4 19h16" /><path d="m7 15 3-4 3 2 5-7" /></svg>
        <span>Stats</span>
      </button>
      {reportsOpen && <ReportsWorkspace baseUrl={baseUrl} traccarApi={traccarApi} onClose={() => setReportsOpen(false)} />}
    </>
  )
}

export default VehicleStatsPanel
