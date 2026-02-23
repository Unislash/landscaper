import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import { BACKGROUND_IMAGE_MAX_MB, readFileAsDataUrl, validateBackgroundFile } from './backgroundUpload';
import {
  getPersistedPlanById,
  listSavedPlanSummaries,
  readPersistedPlans,
  setActivePersistedPlan,
  type SavedPlanSummary,
  upsertPersistedPlan,
} from './planPersistence';
import { useLandscaperStore } from './state/store';
import {
  COLOR_OPTIONS,
  SHAPE_OPTIONS,
  type ElementColor,
  type PlanElement,
  type ShapeId,
  type Stamp,
} from './state/types';

const toolButtons = [
  { id: 'select', label: 'Select' },
  { id: 'stamp', label: 'Stamp' },
] as const;

const STAMP_BASE_SIZE = 56;
const STAMP_MIN_SCALE = 0.2;
const STAMP_MAX_SCALE = 6;
const CANVAS_CENTER_FALLBACK = { x: 320, y: 260 };
const MIN_CANVAS_ZOOM = 0.4;
const MAX_CANVAS_ZOOM = 2.6;

type ResizeHandle = 'top' | 'right' | 'bottom' | 'left';

interface DragState {
  stampId: string;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
}

interface DragPreview {
  stampId: string;
  x: number;
  y: number;
}

interface ResizeState {
  stampId: string;
  elementId: string;
  handle: ResizeHandle;
  centerX: number;
  centerY: number;
  initialScale: number;
  previewScale: number;
}

interface PlanNotice {
  variant: 'success' | 'error';
  message: string;
}

const colorToHex: Record<ElementColor, string> = {
  Green: '#4c8a47',
  'Dark Green': '#2f5f32',
  Brown: '#7a5b3a',
  Gray: '#6a6f73',
  Blue: '#2f6f9f',
};

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

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const formatSavedTimestamp = (value: string): string => {
  const parsedValue = Date.parse(value);
  if (Number.isNaN(parsedValue)) {
    return 'Saved';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsedValue);
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  );
};

const renderShape = (shapeId: ShapeId, color: string) => {
  switch (shapeId) {
    case 'circle':
      return <circle cx="50" cy="50" r="32" fill={color} stroke="#1f3d22" strokeWidth="3" />;
    case 'square':
      return (
        <rect x="18" y="18" width="64" height="64" rx="8" fill={color} stroke="#1f3d22" strokeWidth="3" />
      );
    case 'triangle':
      return <polygon points="50,14 86,82 14,82" fill={color} stroke="#1f3d22" strokeWidth="3" />;
    case 'shrub':
      return (
        <>
          <circle cx="35" cy="56" r="22" fill={color} stroke="#1f3d22" strokeWidth="2.5" />
          <circle cx="65" cy="56" r="22" fill={color} stroke="#1f3d22" strokeWidth="2.5" />
          <circle cx="50" cy="36" r="22" fill={color} stroke="#1f3d22" strokeWidth="2.5" />
        </>
      );
    default:
      return null;
  }
};

function App() {
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);

  const plan = useLandscaperStore((state) => state.plan);
  const planName = useLandscaperStore((state) => state.plan.name);
  const backgroundImage = useLandscaperStore((state) => state.plan.backgroundImage);
  const createNewPlan = useLandscaperStore((state) => state.createNewPlan);
  const loadPlan = useLandscaperStore((state) => state.loadPlan);
  const setPlanName = useLandscaperStore((state) => state.setPlanName);
  const setBackgroundImage = useLandscaperStore((state) => state.setBackgroundImage);
  const viewport = useLandscaperStore((state) => state.plan.viewport);
  const setViewport = useLandscaperStore((state) => state.setViewport);
  const activeTool = useLandscaperStore((state) => state.ui.activeTool);
  const setActiveTool = useLandscaperStore((state) => state.setActiveTool);
  const resizeMode = useLandscaperStore((state) => state.ui.selection.resizeMode);
  const setResizeMode = useLandscaperStore((state) => state.setResizeMode);
  const selectedElementId = useLandscaperStore((state) => state.ui.selectedElementId);
  const selectElement = useLandscaperStore((state) => state.selectElement);
  const selectedStampId = useLandscaperStore((state) => state.ui.selection.selectedStampId);
  const selectStamp = useLandscaperStore((state) => state.selectStamp);
  const elements = useLandscaperStore((state) => state.plan.elements);
  const addElement = useLandscaperStore((state) => state.addElement);
  const updateElement = useLandscaperStore((state) => state.updateElement);
  const deleteElement = useLandscaperStore((state) => state.deleteElement);
  const stamps = useLandscaperStore((state) => state.plan.stamps);
  const stampElement = useLandscaperStore((state) => state.stampElement);
  const moveStamp = useLandscaperStore((state) => state.moveStamp);
  const bringStampToFront = useLandscaperStore((state) => state.bringStampToFront);
  const sendStampToBack = useLandscaperStore((state) => state.sendStampToBack);
  const undo = useLandscaperStore((state) => state.undo);
  const redo = useLandscaperStore((state) => state.redo);
  const historyCount = useLandscaperStore((state) => state.history.past.length);
  const futureHistoryCount = useLandscaperStore((state) => state.history.future.length);
  const [backgroundUploadError, setBackgroundUploadError] = useState<string | null>(null);
  const [isShapePickerOpen, setIsShapePickerOpen] = useState(false);
  const [savedPlanSummaries, setSavedPlanSummaries] = useState<SavedPlanSummary[]>([]);
  const [selectedSavedPlanId, setSelectedSavedPlanId] = useState<string>('');
  const [planNotice, setPlanNotice] = useState<PlanNotice | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  const elementsById = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements],
  );
  const sortedStamps = useMemo(
    () => [...stamps].sort((firstStamp, secondStamp) => firstStamp.zIndex - secondStamp.zIndex),
    [stamps],
  );

  const selectedElement = useMemo(
    () => elements.find((element) => element.id === selectedElementId) ?? null,
    [elements, selectedElementId],
  );
  const selectedStamp = useMemo(
    () => stamps.find((stamp) => stamp.id === selectedStampId) ?? null,
    [selectedStampId, stamps],
  );
  const canUndo = historyCount > 0;
  const canRedo = futureHistoryCount > 0;

  const viewportTransformStyle = useMemo(
    () => ({
      transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
    }),
    [viewport.panX, viewport.panY, viewport.zoom],
  );

  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const surfaceRect = canvasSurfaceRef.current?.getBoundingClientRect();
    if (!surfaceRect) {
      return null;
    }

    const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
    const width = surfaceRect.width / zoom;
    const height = surfaceRect.height / zoom;

    return {
      x: clamp((clientX - surfaceRect.left - viewport.panX) / zoom, 0, width),
      y: clamp((clientY - surfaceRect.top - viewport.panY) / zoom, 0, height),
      width,
      height,
    };
  }, [viewport.panX, viewport.panY, viewport.zoom]);

  const getCanvasCenter = useCallback(() => {
    const surfaceRect = canvasSurfaceRef.current?.getBoundingClientRect();
    if (!surfaceRect) {
      return CANVAS_CENTER_FALLBACK;
    }

    const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
    const width = surfaceRect.width / zoom;
    const height = surfaceRect.height / zoom;

    return {
      x: clamp((surfaceRect.width / 2 - viewport.panX) / zoom, 0, width),
      y: clamp((surfaceRect.height / 2 - viewport.panY) / zoom, 0, height),
    };
  }, [viewport.panX, viewport.panY, viewport.zoom]);

  useEffect(() => {
    if (!selectedElementId && elements.length > 0) {
      selectElement(elements[0].id);
      return;
    }

    if (selectedElementId && !selectedElement) {
      selectElement(elements[0]?.id ?? null);
    }
  }, [elements, selectElement, selectedElement, selectedElementId]);

  useEffect(() => {
    if (activeTool === 'stamp' && resizeMode) {
      setResizeMode(false);
    }
  }, [activeTool, resizeMode, setResizeMode]);

  const runUndo = useCallback(() => {
    setDragState(null);
    setDragPreview(null);
    setResizeState(null);
    undo();
  }, [undo]);

  const runRedo = useCallback(() => {
    setDragState(null);
    setDragPreview(null);
    setResizeState(null);
    redo();
  }, [redo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hasUndoModifier = event.metaKey || event.ctrlKey;
      if (!hasUndoModifier || isEditableTarget(event.target)) {
        return;
      }

      const pressedKey = event.key.toLowerCase();
      const shouldUndo = pressedKey === 'z' && !event.shiftKey;
      const shouldRedo = (pressedKey === 'z' && event.shiftKey) || pressedKey === 'y';

      if (shouldUndo && canUndo) {
        event.preventDefault();
        runUndo();
        return;
      }

      if (shouldRedo && canRedo) {
        event.preventDefault();
        runRedo();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [canRedo, canUndo, runRedo, runUndo]);

  useEffect(() => {
    const persistedPlans = readPersistedPlans();
    const summaries = listSavedPlanSummaries(persistedPlans);
    setSavedPlanSummaries(summaries);

    const activePlanId = persistedPlans.activePlanId ?? summaries[0]?.id ?? '';
    if (!activePlanId) {
      setSelectedSavedPlanId('');
      return;
    }

    const persistedPlan = persistedPlans.plans.find((entry) => entry.plan.id === activePlanId)?.plan;
    if (!persistedPlan) {
      setSelectedSavedPlanId('');
      return;
    }

    loadPlan(persistedPlan);
    setSelectedSavedPlanId(activePlanId);
  }, [loadPlan]);

  useEffect(() => {
    if (!planNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPlanNotice(null);
    }, 3200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [planNotice]);

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

  const handleCreateNewPlan = () => {
    createNewPlan('Untitled Plan');
    setSelectedSavedPlanId('');
    setPlanNotice({
      variant: 'success',
      message: 'Created a new plan. Save snapshot to store it locally.',
    });
  };

  const handleSavePlanSnapshot = () => {
    const persistedPlans = upsertPersistedPlan(plan);
    if (!persistedPlans) {
      setPlanNotice({
        variant: 'error',
        message: 'Unable to save plan in local storage.',
      });
      return;
    }

    const summaries = listSavedPlanSummaries(persistedPlans);
    setSavedPlanSummaries(summaries);
    setSelectedSavedPlanId(plan.id);
    setPlanNotice({
      variant: 'success',
      message: `Saved "${plan.name || 'Untitled Plan'}" locally.`,
    });
  };

  const handleLoadSelectedPlan = () => {
    if (!selectedSavedPlanId) {
      return;
    }

    const loadedPlan = getPersistedPlanById(selectedSavedPlanId);
    if (!loadedPlan) {
      setPlanNotice({
        variant: 'error',
        message: 'Selected plan was not found in local storage.',
      });
      return;
    }

    loadPlan(loadedPlan);
    const persistedPlans = setActivePersistedPlan(selectedSavedPlanId);
    if (persistedPlans) {
      setSavedPlanSummaries(listSavedPlanSummaries(persistedPlans));
    }
    setPlanNotice({
      variant: 'success',
      message: `Loaded "${loadedPlan.name}".`,
    });
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = getCanvasPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    if (activeTool === 'stamp') {
      if (!selectedElement) {
        return;
      }

      const newStampId = stampElement(selectedElement.id, {
        x: point.x,
        y: point.y,
      });

      if (newStampId) {
        selectStamp(newStampId);
        setResizeMode(false);
      }
      return;
    }

    selectStamp(null);
    setResizeMode(false);
    setDragState(null);
    setDragPreview(null);
    setResizeState(null);
  };

  const handleCanvasWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey) {
      return;
    }

    event.preventDefault();

    const zoomDelta = -event.deltaY * 0.0015;
    const nextZoom = clamp(viewport.zoom * (1 + zoomDelta), MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM);
    if (Math.abs(nextZoom - viewport.zoom) < 0.0001) {
      return;
    }

    setViewport({
      zoom: Number(nextZoom.toFixed(3)),
    });
  };

  const handleStampPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    stamp: Stamp,
  ) => {
    if (activeTool !== 'select') {
      return;
    }

    const point = getCanvasPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    event.stopPropagation();
    selectStamp(stamp.id);
    selectElement(stamp.elementId);
    setDragState({
      stampId: stamp.id,
      offsetX: point.x - stamp.x,
      offsetY: point.y - stamp.y,
      startX: stamp.x,
      startY: stamp.y,
    });
    setDragPreview({
      stampId: stamp.id,
      x: stamp.x,
      y: stamp.y,
    });
  };

  const handleResizeHandlePointerDown = (
    event: ReactPointerEvent<HTMLSpanElement>,
    stamp: Stamp,
    element: PlanElement,
    handle: ResizeHandle,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    setActiveTool('select');
    selectStamp(stamp.id);
    selectElement(stamp.elementId);
    setResizeMode(true);
    setResizeState({
      stampId: stamp.id,
      elementId: stamp.elementId,
      handle,
      centerX: stamp.x,
      centerY: stamp.y,
      initialScale: element.scale,
      previewScale: element.scale,
    });
  };

  useEffect(() => {
    if (!dragState && !resizeState) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      if (dragState) {
        setDragPreview({
          stampId: dragState.stampId,
          x: point.x - dragState.offsetX,
          y: point.y - dragState.offsetY,
        });
      }

      if (resizeState) {
        const distanceFromCenter =
          resizeState.handle === 'left' || resizeState.handle === 'right'
            ? Math.abs(point.x - resizeState.centerX)
            : Math.abs(point.y - resizeState.centerY);
        const nextScale = clamp((distanceFromCenter * 2) / STAMP_BASE_SIZE, STAMP_MIN_SCALE, STAMP_MAX_SCALE);

        setResizeState((currentState) => {
          if (!currentState) {
            return null;
          }

          return {
            ...currentState,
            previewScale: nextScale,
          };
        });
      }
    };

    const onPointerEnd = () => {
      if (dragState && dragPreview) {
        const moved =
          Math.abs(dragPreview.x - dragState.startX) > 0.5 ||
          Math.abs(dragPreview.y - dragState.startY) > 0.5;
        if (moved) {
          moveStamp(dragState.stampId, {
            x: dragPreview.x,
            y: dragPreview.y,
          });
        }
      }

      if (resizeState) {
        const scaleChanged = Math.abs(resizeState.previewScale - resizeState.initialScale) > 0.001;
        if (scaleChanged) {
          updateElement(resizeState.elementId, {
            scale: resizeState.previewScale,
          });
        }
      }

      setDragState(null);
      setDragPreview(null);
      setResizeState(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [dragPreview, dragState, getCanvasPoint, moveStamp, resizeState, updateElement]);

  const handleBringToFront = () => {
    if (!selectedStampId) {
      return;
    }

    bringStampToFront(selectedStampId);
  };

  const handleSendToBack = () => {
    if (!selectedStampId) {
      return;
    }

    sendStampToBack(selectedStampId);
  };

  const handleResizeAction = () => {
    if (!selectedElement) {
      return;
    }

    setActiveTool('select');
    setResizeMode(true);

    if (selectedStamp) {
      selectElement(selectedStamp.elementId);
      return;
    }

    const existingStamp = stamps.find((stamp) => stamp.elementId === selectedElement.id);
    if (existingStamp) {
      selectStamp(existingStamp.id);
      return;
    }

    const centerPoint = getCanvasCenter();
    const createdStampId = stampElement(selectedElement.id, centerPoint);
    if (createdStampId) {
      selectStamp(createdStampId);
    }
  };

  const selectedStampElement = selectedStamp ? elementsById.get(selectedStamp.elementId) : null;
  const selectedStampScale =
    selectedStamp && selectedStampElement
      ? resizeState && resizeState.stampId === selectedStamp.id
        ? resizeState.previewScale
        : selectedStampElement.scale
      : null;
  const selectedStampSize = selectedStampScale ? selectedStampScale * STAMP_BASE_SIZE : null;

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
          <button
            type="button"
            className="tool-button"
            onClick={runUndo}
            disabled={!canUndo}
            title="Undo (Ctrl/Cmd+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="tool-button"
            onClick={runRedo}
            disabled={!canRedo}
            title="Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)"
          >
            Redo
          </button>
        </div>
        <div className="toolbar-group">
          <button type="button" className="tool-button" onClick={handleBringToFront} disabled={!selectedStampId}>
            Bring to Front
          </button>
          <button type="button" className="tool-button" onClick={handleSendToBack} disabled={!selectedStampId}>
            Send to Back
          </button>
          <button type="button" className="tool-button" onClick={handleResizeAction} disabled={!selectedElement}>
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
          <div
            ref={canvasSurfaceRef}
            className={activeTool === 'stamp' ? 'canvas-surface stamp-mode-surface' : 'canvas-surface'}
            onPointerDown={handleCanvasPointerDown}
            onWheel={handleCanvasWheel}
          >
            <div className="canvas-viewport" style={viewportTransformStyle}>
              {backgroundImage ? (
                <img src={backgroundImage} alt="Plan background" className="canvas-background-image" />
              ) : (
                <p className="canvas-empty-state">
                  Upload a background image (under {BACKGROUND_IMAGE_MAX_MB}MB) to start your layout.
                </p>
              )}
              <div className={activeTool === 'stamp' ? 'stamp-layer stamp-layer-disabled' : 'stamp-layer'}>
                {sortedStamps.map((stamp) => {
                  const stampElementDefinition = elementsById.get(stamp.elementId);
                  if (!stampElementDefinition) {
                    return null;
                  }

                  const previewPosition =
                    dragPreview && dragPreview.stampId === stamp.id
                      ? { x: dragPreview.x, y: dragPreview.y }
                      : { x: stamp.x, y: stamp.y };
                  const effectiveScale =
                    resizeState && resizeState.elementId === stamp.elementId
                      ? resizeState.previewScale
                      : stampElementDefinition.scale;
                  const stampSize = effectiveScale * STAMP_BASE_SIZE;
                  const isSelected = stamp.id === selectedStampId;
                  const isDragging = dragState?.stampId === stamp.id;
                  const stampShapeColor = colorToHex[stampElementDefinition.color];

                  return (
                    <button
                      key={stamp.id}
                      type="button"
                      className={
                        isSelected
                          ? isDragging
                            ? 'stamp-item selected dragging'
                            : 'stamp-item selected'
                          : 'stamp-item'
                      }
                      style={{
                        width: `${stampSize}px`,
                        height: `${stampSize}px`,
                        left: `${previewPosition.x - stampSize / 2}px`,
                        top: `${previewPosition.y - stampSize / 2}px`,
                        zIndex: stamp.zIndex + 100,
                      }}
                      onPointerDown={(event) => handleStampPointerDown(event, stamp)}
                      aria-label={`Stamp ${stampElementDefinition.name}`}
                    >
                      <svg className="stamp-shape" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
                        {renderShape(stampElementDefinition.shapeId, stampShapeColor)}
                      </svg>
                      {isSelected && resizeMode ? (
                        <div className="resize-handle-layer">
                          {(['top', 'right', 'bottom', 'left'] as const).map((handle) => (
                            <span
                              key={handle}
                              className={`resize-handle handle-${handle}`}
                              onPointerDown={(event) =>
                                handleResizeHandlePointerDown(event, stamp, stampElementDefinition, handle)
                              }
                            />
                          ))}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="canvas-hint" role="status">
              {activeTool === 'stamp'
                ? 'Stamp tool active: click anywhere in the canvas to place the selected element.'
                : resizeMode
                  ? 'Resize mode active: drag the edge handles to scale the selected stamp from center.'
                  : 'Select tool active: click a stamp to select and drag it.'}
              {' '}
              Shift+Scroll zooms the canvas.
            </p>
            <div className="canvas-zoom-indicator">Zoom {Math.round(viewport.zoom * 100)}%</div>
            <dl className="canvas-summary">
              <dt>Elements</dt>
              <dd>{elements.length}</dd>
              <dt>Stamps</dt>
              <dd>{stamps.length}</dd>
              <dt>Selected stamp</dt>
              <dd>{selectedStampId ?? 'None'}</dd>
              <dt>Selected size</dt>
              <dd>{selectedStampSize ? `${selectedStampSize.toFixed(1)}px` : 'None'}</dd>
              <dt>History checkpoints</dt>
              <dd>{historyCount}</dd>
              <dt>Redo checkpoints</dt>
              <dd>{futureHistoryCount}</dd>
            </dl>
          </div>
        </section>
      </main>

      <aside className="right-panel" aria-label="Element details">
        <section className="panel-section">
          <div className="section-header">
            <h2 className="region-title">Plans</h2>
          </div>
          <div className="plan-actions-grid">
            <button type="button" className="tool-button panel-action" onClick={handleCreateNewPlan}>
              New Plan
            </button>
            <button type="button" className="tool-button panel-action" onClick={handleSavePlanSnapshot}>
              Save Snapshot
            </button>
          </div>
          <label className="field-label" htmlFor="saved-plan-select">
            Saved plans
          </label>
          <select
            id="saved-plan-select"
            value={selectedSavedPlanId}
            onChange={(event) => setSelectedSavedPlanId(event.target.value)}
          >
            {savedPlanSummaries.length === 0 ? (
              <option value="">No saved plans yet</option>
            ) : (
              savedPlanSummaries.map((summary) => (
                <option key={summary.id} value={summary.id}>
                  {summary.name || 'Untitled Plan'} ({formatSavedTimestamp(summary.savedAt)})
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className="tool-button panel-action"
            onClick={handleLoadSelectedPlan}
            disabled={!selectedSavedPlanId}
          >
            Load Selected
          </button>
          {savedPlanSummaries.length === 0 ? (
            <p className="panel-note">No saved plans yet. Create one, then save it.</p>
          ) : (
            <ul className="saved-plan-list">
              {savedPlanSummaries.map((summary) => (
                <li
                  key={summary.id}
                  className={summary.id === plan.id ? 'saved-plan-item active' : 'saved-plan-item'}
                >
                  <span>{summary.name || 'Untitled Plan'}</span>
                  <span>{formatSavedTimestamp(summary.savedAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="panel-note">Rename by editing plan name, then saving the snapshot.</p>
        </section>

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

      {planNotice ? (
        <div className={planNotice.variant === 'error' ? 'plan-toast error' : 'plan-toast success'} role="status">
          {planNotice.message}
        </div>
      ) : null}

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
