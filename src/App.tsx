import { useEffect, useMemo, useState, type ChangeEvent } from 'react';

import { BACKGROUND_IMAGE_MAX_MB, readFileAsDataUrl, validateBackgroundFile } from './backgroundUpload';
import { useLandscaperStore } from './state/store';
import { COLOR_OPTIONS, SHAPE_OPTIONS, type PlanElement } from './state/types';

const toolButtons = [{ id: 'select', label: 'Select' }] as const;

const createElementId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `element-${crypto.randomUUID()}`;
  }

  return `element-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const createDefaultElement = (elementCount: number): PlanElement => ({
  id: createElementId(),
  name: `Element ${elementCount + 1}`,
  shapeId: 'circle',
  color: 'Green',
  scale: 1,
});

function App() {
  const planName = useLandscaperStore((state) => state.plan.name);
  const backgroundImage = useLandscaperStore((state) => state.plan.backgroundImage);
  const setPlanName = useLandscaperStore((state) => state.setPlanName);
  const setBackgroundImage = useLandscaperStore((state) => state.setBackgroundImage);
  const activeTool = useLandscaperStore((state) => state.ui.activeTool);
  const setActiveTool = useLandscaperStore((state) => state.setActiveTool);
  const selectedElementId = useLandscaperStore((state) => state.ui.selectedElementId);
  const selectElement = useLandscaperStore((state) => state.selectElement);
  const selectedStampId = useLandscaperStore((state) => state.ui.selection.selectedStampId);
  const elements = useLandscaperStore((state) => state.plan.elements);
  const addElement = useLandscaperStore((state) => state.addElement);
  const updateElement = useLandscaperStore((state) => state.updateElement);
  const deleteElement = useLandscaperStore((state) => state.deleteElement);
  const stamps = useLandscaperStore((state) => state.plan.stamps);
  const historyCount = useLandscaperStore((state) => state.history.past.length);
  const [backgroundUploadError, setBackgroundUploadError] = useState<string | null>(null);
  const [isShapePickerOpen, setIsShapePickerOpen] = useState(false);

  const selectedElement = useMemo(
    () => elements.find((element) => element.id === selectedElementId) ?? null,
    [elements, selectedElementId],
  );

  useEffect(() => {
    if (!selectedElementId && elements.length > 0) {
      selectElement(elements[0].id);
      return;
    }

    if (selectedElementId && !selectedElement) {
      selectElement(elements[0]?.id ?? null);
    }
  }, [elements, selectElement, selectedElement, selectedElementId]);

  const handleBackgroundFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    event.target.value = '';

    if (!nextFile) {
      return;
    }

    const validationError = validateBackgroundFile(nextFile);
    if (validationError) {
      setBackgroundUploadError(validationError);
      return;
    }

    try {
      const nextBackgroundImage = await readFileAsDataUrl(nextFile);
      setBackgroundImage(nextBackgroundImage);
      setBackgroundUploadError(null);
    } catch {
      setBackgroundUploadError('Unable to read image data.');
    }
  };

  const handleAddElement = () => {
    const element = createDefaultElement(elements.length);
    addElement(element);
    selectElement(element.id);
  };

  const handleDeleteElement = () => {
    if (!selectedElement) {
      return;
    }

    deleteElement(selectedElement.id);
  };

  return (
    <div className="app-shell">
      <aside className="left-toolbar" aria-label="Editor tools">
        <h2 className="region-title">Tools</h2>
        <div className="toolbar-group">
          {toolButtons.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={activeTool === tool.id ? 'tool-button active' : 'tool-button'}
              onClick={() => setActiveTool(tool.id)}
            >
              {tool.label}
            </button>
          ))}
        </div>
        <div className="toolbar-group">
          <button type="button" className="tool-button" disabled>
            Undo
          </button>
          <button type="button" className="tool-button" disabled>
            Redo
          </button>
        </div>
        <div className="toolbar-group">
          <button type="button" className="tool-button" disabled>
            Bring to Front
          </button>
          <button type="button" className="tool-button" disabled>
            Send to Back
          </button>
          <button type="button" className="tool-button" disabled>
            Resize Element
          </button>
        </div>
      </aside>

      <main className="editor-area">
        <section className="plan-name-panel" aria-label="Plan details">
          <label htmlFor="plan-name-input">Plan name</label>
          <input
            id="plan-name-input"
            name="plan-name"
            value={planName}
            onChange={(event) => setPlanName(event.target.value)}
          />
        </section>

        <section className="canvas-region" aria-label="Canvas area">
          <h1>Landscaper Canvas</h1>
          <div className="canvas-surface">
            {backgroundImage ? (
              <img src={backgroundImage} alt="Plan background" className="canvas-background-image" />
            ) : (
              <p className="canvas-empty-state">
                Upload a background image (under {BACKGROUND_IMAGE_MAX_MB}MB) to start your layout.
              </p>
            )}
            <dl className="canvas-summary">
              <dt>Elements</dt>
              <dd>{elements.length}</dd>
              <dt>Stamps</dt>
              <dd>{stamps.length}</dd>
              <dt>Selected stamp</dt>
              <dd>{selectedStampId ?? 'None'}</dd>
              <dt>History checkpoints</dt>
              <dd>{historyCount}</dd>
            </dl>
          </div>
        </section>
      </main>

      <aside className="right-panel" aria-label="Element details">
        <section className="panel-section">
          <h2 className="region-title">Background</h2>
          <label className="field-label" htmlFor="background-upload-input">
            Upload image
          </label>
          <input
            id="background-upload-input"
            type="file"
            accept="image/*"
            onChange={(event) => {
              void handleBackgroundFileChange(event);
            }}
          />
          <button
            type="button"
            className="tool-button panel-action"
            onClick={() => {
              setBackgroundImage(null);
              setBackgroundUploadError(null);
            }}
            disabled={!backgroundImage}
          >
            Remove background
          </button>
          {backgroundUploadError ? (
            <p className="error-note" role="status">
              {backgroundUploadError}
            </p>
          ) : null}
        </section>

        <section className="panel-section">
          <div className="section-header">
            <h2 className="region-title">Elements</h2>
            <button type="button" className="tool-button panel-action" onClick={handleAddElement}>
              Add Element
            </button>
          </div>
          <ul className="element-list">
            {elements.map((element) => (
              <li key={element.id}>
                <button
                  type="button"
                  className={
                    element.id === selectedElementId ? 'element-list-button selected' : 'element-list-button'
                  }
                  onClick={() => selectElement(element.id)}
                >
                  <span className="element-name">{element.name}</span>
                  <span>
                    {element.shapeId} - {element.color} - scale {element.scale.toFixed(2)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel-section">
          <h2 className="region-title">Element Details</h2>
          {selectedElement ? (
            <div className="form-grid">
              <label className="field-label" htmlFor="element-name-input">
                Name
              </label>
              <input
                id="element-name-input"
                value={selectedElement.name}
                onChange={(event) =>
                  updateElement(selectedElement.id, {
                    name: event.target.value,
                  })
                }
              />

              <span className="field-label">Shape</span>
              <button
                type="button"
                className="tool-button panel-action"
                onClick={() => setIsShapePickerOpen(true)}
              >
                Choose shape ({selectedElement.shapeId})
              </button>

              <label className="field-label" htmlFor="element-color-input">
                Color
              </label>
              <select
                id="element-color-input"
                value={selectedElement.color}
                onChange={(event) =>
                  updateElement(selectedElement.id, {
                    color: event.target.value as PlanElement['color'],
                  })
                }
              >
                {COLOR_OPTIONS.map((colorOption) => (
                  <option key={colorOption} value={colorOption}>
                    {colorOption}
                  </option>
                ))}
              </select>

              <label className="field-label" htmlFor="element-scale-input">
                Scale
              </label>
              <input
                id="element-scale-input"
                type="number"
                min={0.1}
                step={0.1}
                value={selectedElement.scale}
                onChange={(event) => {
                  const nextScale = Number(event.target.value);
                  if (Number.isFinite(nextScale) && nextScale > 0) {
                    updateElement(selectedElement.id, {
                      scale: nextScale,
                    });
                  }
                }}
              />

              <button type="button" className="tool-button danger-button" onClick={handleDeleteElement}>
                Delete Element
              </button>
            </div>
          ) : (
            <p className="panel-note">Add an element to begin editing.</p>
          )}
        </section>
      </aside>

      {isShapePickerOpen && selectedElement ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsShapePickerOpen(false)}>
          <div
            className="shape-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Choose element shape"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Choose a shape</h2>
            <div className="shape-option-grid">
              {SHAPE_OPTIONS.map((shapeOption) => (
                <button
                  key={shapeOption}
                  type="button"
                  className={
                    selectedElement.shapeId === shapeOption
                      ? 'tool-button shape-option active-shape'
                      : 'tool-button shape-option'
                  }
                  onClick={() => {
                    updateElement(selectedElement.id, { shapeId: shapeOption });
                    setIsShapePickerOpen(false);
                  }}
                >
                  {shapeOption}
                </button>
              ))}
            </div>
            <button type="button" className="tool-button panel-action" onClick={() => setIsShapePickerOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
