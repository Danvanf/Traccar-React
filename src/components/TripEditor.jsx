function TripEditor({
  tripEditorLoading,
  tripEditorDisabled,
  tripEditorStatus,
  tripEditorTags,
  availableTripTags,
  tagToAdd,
  setTagToAdd,
  addSelectedTripTag,
  removeSelectedTripTag,
  noteDraft,
  setNoteDraft,
  saveSelectedTripNote,
}) {
  return <div className="trip-editor trip-editor-dialog-content">
    {tripEditorLoading && <div className="trip-empty">Loading trip metadata...</div>}
    {tripEditorStatus && <div className="trip-empty">{tripEditorStatus}</div>}

    {!tripEditorLoading && (
      <>
        <label>
          Add Tag
          <div className="trip-editor-tag-row">
            <select disabled={tripEditorDisabled} value={tagToAdd} onChange={(event) => setTagToAdd(event.target.value)}>
              <option value="">Select tag</option>
              {availableTripTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
            <button type="button" className="small secondary" onClick={addSelectedTripTag} disabled={tripEditorDisabled || !tagToAdd}>Add</button>
          </div>
        </label>

        {tripEditorTags.length > 0 && (
          <div className="trip-editor-tags">
            {tripEditorTags.map((tag) => (
              <button key={tag.id} type="button" className="trip-tag-chip" onClick={() => removeSelectedTripTag(tag.id)} disabled={tripEditorDisabled}>
                {tag.name} ×
              </button>
            ))}
          </div>
        )}

        <label>
          Trip Notes
          <textarea
            disabled={tripEditorDisabled}
            rows={3}
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="Add contextual notes for this trip"
          />
        </label>
        <button type="button" className="small" onClick={saveSelectedTripNote} disabled={tripEditorDisabled}>Save Notes</button>
      </>
    )}
  </div>
}

export default TripEditor
