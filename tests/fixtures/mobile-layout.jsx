// Isolated shell acceptance fixture. No API calls, storage, or account writes.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import AppLayout from '../../src/components/layout/AppLayout'
import MoreMenu from '../../src/components/layout/MoreMenu'
import DeviceList from '../../src/components/DeviceList'
import '../../src/index.css'
import '../../src/App.css'
import '../../src/components/layout/layout.css'

const longName = 'Family touring vehicle with a deliberately long descriptive device name'
const devices = [{ id: 1, name: longName }, { id: 2, name: 'Another vehicle with a long descriptive device name' }]

function doubleText() {
  if (document.documentElement.dataset.fixtureTextScale === '2') return
  // Capture all original sizes before changing any ancestor's inherited size.
  const sizes = [...document.querySelectorAll('.scope-layout, .scope-layout *')]
    .map((element) => [element, parseFloat(getComputedStyle(element).fontSize)])
  sizes.forEach(([element, size]) => { element.style.fontSize = `${size * 2}px` })
  document.documentElement.dataset.fixtureTextScale = '2'
}

function Fixture() {
  const [selected, setSelected] = useState(1)
  const [visibility, setVisibility] = useState({ 1: true, 2: true })
  const [task, setTask] = useState(null)
  const [picking, setPicking] = useState(false)
  const taskContent = <section>
    <p>This task uses sample content and never saves data.</p>
    <button type="button" onClick={doubleText}>Double text for test</button>
    <label>Example note<textarea defaultValue="Unsaved sample note" /></label>
    {Array.from({ length: 15 }, (_, i) => <p key={i}>Sample row {i + 1}: long descriptions should wrap within the task's scrolling content.</p>)}
    <button type="button" onClick={() => setTask(null)}>Finish test task</button>
  </section>
  return <main className="app-shell">
    <AppLayout
      map={<div className="scope-map-canvas" style={{ padding: 12 }}>
        <p>Fixture map area — no real map or live data.</p>
        <button type="button" onClick={doubleText}>Double text for test</button>
      </div>}
      mapOverlay={{ onZoomIn: () => {}, onZoomOut: () => {}, onFit: () => {}, onCancelLocation: () => setPicking(false) }}
      mapPicking={picking}
      deviceName={devices.find((device) => device.id === selected).name}
      connectionState="ok"
      pointTimestamp={new Date('2026-10-21T12:00:00Z')}
      accountControls={<div className="global-auth-controls"><button type="button" className="global-auth-username">Example account with a long name</button></div>}
      devices={({ onDeviceSelected }) => <DeviceList devices={devices} deviceColors={{}} deviceVisibility={visibility} setDeviceVisibility={setVisibility} selectedDeviceId={selected} expanded onExpandedChange={() => {}} onSelectDevice={(id) => { setSelected(id); onDeviceSelected() }} />}
      status={<p>Sample status content.</p>}
      more={<MoreMenu items={[{ label: 'Start sample location pick', onSelect: () => setPicking(true) }, { label: 'Open sample task', onSelect: () => setTask({ title: 'Vehicle reports and telemetry with a long task heading', content: taskContent }) }]} />}
      trips={() => <p>Trip panel consolidation is outside this fixture.</p>}
      task={task}
      onTaskClose={() => setTask(null)}
    />
  </main>
}

createRoot(document.getElementById('root')).render(<Fixture />)