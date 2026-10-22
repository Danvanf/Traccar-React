function MapContainer({ elementRef, className = 'map-canvas' }) {
  return <div ref={elementRef} className={className} />
}

export default MapContainer
