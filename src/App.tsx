import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import { BACKGROUND_IMAGE_MAX_MB, readFileAsDataUrl, validateBackgroundFile } from './backgroundUpload';
import {
  getPersistedPlanById,
  listSavedPlanSummaries,
  readPersistedPlans,
  upsertPersistedPlan,
  type SavedPlanSummary,
} from './planPersistence';
import { SHAPE_SVGS } from './resources/shapeAssets';
import { useLandscaperStore } from './state/store';
import {
  COLOR_OPTIONS,
  SHAPE_OPTIONS,
  type ElementColor,
  type PlanElement,
  type ShapeId,
  type Stamp,
  type ToolMode,
} from './state/types';

const toolButtons = [
  { id: 'stamp', label: 'Stamp' },
  { id: 'select', label: 'Select' },
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
  Green: '#568f14',
  Moss: '#4C7A5A',
  Pine: '#2E4A3A',
  Teal: '#2F4A52',
  Azure: '#0a4283',
  Seafoam: '#7FA7A2',
  Sand: '#AFA487',
  Walnut: '#6e4b36',
  Coffee: '#4b392e',
  Charcoal: '#1f2524',
  'Olive Gray': '#6A7062',
  Slate: '#5F6F73',
  Lavender: '#7E6F98',
  Wheat: '#D6C768',
  Amber: '#e39b55',
  Rose: '#dbb8c3',
  Coral: '#d96a5f',
};

const DEFAULT_COLOR: ElementColor = 'Pine';
const getColorHex = (color: ElementColor | null | undefined): string =>
  colorToHex[color ?? DEFAULT_COLOR] ?? colorToHex[DEFAULT_COLOR];

const createElementId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `element-${crypto.randomUUID()}`;
  }

  return `element-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const DEFAULT_SHAPE_ID = SHAPE_OPTIONS[0];

const SHAPE_RENDER_INFO: Partial<
  Record<ShapeId, { maskSource: string; isInline: boolean; viewBox?: { width: number; height: number } | null }>
> = {};

const SHAPE_BITMAP_SIZE = 256;
const SHAPE_BITMAP_CACHE = new Map<string, string>();
const SHAPE_BITMAP_PENDING = new Set<string>();
let supportsColorBlendMode: boolean | null = null;

const createDefaultElement = (elementCount: number): PlanElement => ({
  id: createElementId(),
  name: `Element ${elementCount + 1}`,
  shapeId: DEFAULT_SHAPE_ID,
  color: DEFAULT_COLOR,
  scale: 1,
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const truncateToDecimals = (value: number, decimals = 2): number => {
  const factor = 10 ** decimals;
  return Math.trunc(value * factor) / factor;
};

const formatScaleDisplay = (value: number): string => {
  const truncated = truncateToDecimals(value, 2);
  return truncated.toFixed(2).replace(/\.?0+$/, '');
};

const parseViewBox = (svgMarkup: string): { width: number; height: number } | null => {
  const match = svgMarkup.match(/viewBox="([^"]+)"/i);
  if (!match) {
    return null;
  }

  const parts = match[1].trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
    return null;
  }

  return { width: parts[2], height: parts[3] };
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

const getShapeRenderInfo = (shapeId: ShapeId, svgMarkup: string) => {
  const cached = SHAPE_RENDER_INFO[shapeId];
  if (cached) {
    return cached;
  }

  const trimmedMarkup = svgMarkup.trim();
  const isInline = trimmedMarkup.startsWith('<svg') || trimmedMarkup.startsWith('<?xml');
  const maskSource = isInline
    ? `url("data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}")`
    : `url("${svgMarkup}")`;
  const viewBox = isInline ? parseViewBox(svgMarkup) : null;

  const info = { maskSource, isInline, viewBox };
  SHAPE_RENDER_INFO[shapeId] = info;
  return info;
};

const loadSvgImage = (svgMarkup: string, isInline: boolean): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load shape image'));

    image.src = isInline
      ? `data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`
      : svgMarkup;
  });

const getBlendMode = (context: CanvasRenderingContext2D): GlobalCompositeOperation => {
  if (supportsColorBlendMode !== null) {
    return supportsColorBlendMode ? 'color' : 'multiply';
  }

  const previous = context.globalCompositeOperation;
  context.globalCompositeOperation = 'color';
  supportsColorBlendMode = context.globalCompositeOperation === 'color';
  context.globalCompositeOperation = previous;
  return supportsColorBlendMode ? 'color' : 'multiply';
};

const createTintedShapeBitmap = async (shapeId: ShapeId, color: string): Promise<string | null> => {
  if (typeof document === 'undefined') {
    return null;
  }

  const resolvedShapeId = SHAPE_SVGS[shapeId] ? shapeId : DEFAULT_SHAPE_ID;
  const svgMarkup = SHAPE_SVGS[resolvedShapeId];
  if (!svgMarkup) {
    return null;
  }

  const { isInline, viewBox } = getShapeRenderInfo(resolvedShapeId, svgMarkup);
  const image = await loadSvgImage(svgMarkup, isInline);
  const canvas = document.createElement('canvas');
  canvas.width = SHAPE_BITMAP_SIZE;
  canvas.height = SHAPE_BITMAP_SIZE;

  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  const sourceWidth = viewBox?.width ?? image.naturalWidth ?? image.width ?? SHAPE_BITMAP_SIZE;
  const sourceHeight = viewBox?.height ?? image.naturalHeight ?? image.height ?? SHAPE_BITMAP_SIZE;
  const scale = Math.min(SHAPE_BITMAP_SIZE / sourceWidth, SHAPE_BITMAP_SIZE / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = (SHAPE_BITMAP_SIZE - drawWidth) / 2;
  const offsetY = (SHAPE_BITMAP_SIZE - drawHeight) / 2;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  context.globalCompositeOperation = getBlendMode(context);
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  context.globalCompositeOperation = 'source-over';

  return canvas.toDataURL('image/png');
};

function App() {
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const zoomTimeoutRef = useRef<number | null>(null);
  const previousToolRef = useRef<ToolMode | null>(null);
  const shiftSelectActiveRef = useRef(false);
  const isMountedRef = useRef(true);

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
  const deleteStamp = useLandscaperStore((state) => state.deleteStamp);
  const bringStampToFront = useLandscaperStore((state) => state.bringStampToFront);
  const sendStampToBack = useLandscaperStore((state) => state.sendStampToBack);
  const undo = useLandscaperStore((state) => state.undo);
  const redo = useLandscaperStore((state) => state.redo);
  const canUndo = useLandscaperStore((state) => state.history.past.length > 0);
  const canRedo = useLandscaperStore((state) => state.history.future.length > 0);
  const [backgroundUploadError, setBackgroundUploadError] = useState<string | null>(null);
  const [isShapePickerOpen, setIsShapePickerOpen] = useState(false);
  const [planNotice, setPlanNotice] = useState<PlanNotice | null>(null);
  const [isPlanSaving, setIsPlanSaving] = useState(false);
  const [isZoomIndicatorVisible, setIsZoomIndicatorVisible] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [isLoadPlanOpen, setIsLoadPlanOpen] = useState(false);
  const [savedPlans, setSavedPlans] = useState<SavedPlanSummary[]>([]);
  const [selectedSavedPlanId, setSelectedSavedPlanId] = useState<string | null>(null);
  const [, setShapeBitmapVersion] = useState(0);
  const paletteSignature = Object.values(colorToHex).join('|');

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    SHAPE_BITMAP_CACHE.clear();
    SHAPE_BITMAP_PENDING.clear();
    supportsColorBlendMode = null;
    setShapeBitmapVersion((version) => version + 1);
  }, [paletteSignature]);

  const getTintedShapeAsset = useCallback((shapeId: ShapeId, color: string) => {
    const normalizedColor = color.toLowerCase();
    const key = `${shapeId}::${normalizedColor}`;
    const cached = SHAPE_BITMAP_CACHE.get(key);
    if (cached) {
      return cached;
    }

    if (typeof document === 'undefined') {
      return null;
    }

    if (!SHAPE_BITMAP_PENDING.has(key)) {
      SHAPE_BITMAP_PENDING.add(key);
      window.setTimeout(() => {
        void createTintedShapeBitmap(shapeId, color)
          .then((dataUrl) => {
            if (dataUrl) {
              SHAPE_BITMAP_CACHE.set(key, dataUrl);
            }
          })
          .catch(() => null)
          .finally(() => {
            SHAPE_BITMAP_PENDING.delete(key);
            if (isMountedRef.current) {
              setShapeBitmapVersion((version) => version + 1);
            }
          });
      }, 0);
    }

    return null;
  }, []);

  useEffect(() => {
    const seen = new Set<string>();
    elements.forEach((element) => {
      const color = getColorHex(element.color);
      const key = `${element.shapeId}::${color.toLowerCase()}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      getTintedShapeAsset(element.shapeId, color);
    });
  }, [elements, getTintedShapeAsset]);

  const renderShape = useCallback(
    (shapeId: ShapeId, color: string, className?: string) => {
      const resolvedShapeId = SHAPE_SVGS[shapeId] ? shapeId : DEFAULT_SHAPE_ID;
      const svgMarkup = SHAPE_SVGS[resolvedShapeId];
      if (!svgMarkup) {
        return null;
      }

      const wrapperClass = className ? `shape-asset ${className}` : 'shape-asset';
      const tintedSource = getTintedShapeAsset(resolvedShapeId, color);

      if (tintedSource) {
        return (
          <span className={wrapperClass}>
            <img className="shape-img" src={tintedSource} alt="" draggable={false} />
          </span>
        );
      }

      const { maskSource, isInline } = getShapeRenderInfo(resolvedShapeId, svgMarkup);

      return (
        <span
          className={wrapperClass}
          style={{ '--shape-color': color, '--shape-mask': maskSource } as CSSProperties}
        >
          {isInline ? (
            <span className="shape-svg" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
          ) : (
            <img className="shape-img" src={svgMarkup} alt="" draggable={false} />
          )}
          <span className="shape-tint" aria-hidden="true" />
        </span>
      );
    },
    [getTintedShapeAsset],
  );

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if ((event.key === 'Backspace' || event.key === 'Delete') && selectedStampId) {
        event.preventDefault();
        deleteStamp(selectedStampId);
        setDragState(null);
        setDragPreview(null);
        setResizeState(null);
        setResizeMode(false);
        return;
      }

      if (event.key === 'Escape' && resizeMode) {
        event.preventDefault();
        setResizeMode(false);
        setResizeState(null);
        setDragState(null);
        setDragPreview(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    deleteStamp,
    resizeMode,
    selectedStampId,
    setResizeMode,
    setDragPreview,
    setDragState,
    setResizeState,
  ]);

  useEffect(() => {
    if (!resizeMode) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.closest('.resize-handle')) {
        return;
      }

      const stampButton = target.closest<HTMLButtonElement>('.stamp-item');
      if (stampButton && stampButton.dataset.stampId === selectedStampId) {
        return;
      }

      setResizeMode(false);
      setResizeState(null);
    };

    window.addEventListener('pointerdown', onPointerDown, true);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [resizeMode, selectedStampId, setResizeMode, setResizeState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Shift' || isEditableTarget(event.target)) {
        return;
      }

      if (shiftSelectActiveRef.current) {
        return;
      }

      shiftSelectActiveRef.current = true;
      previousToolRef.current = activeTool;

      if (activeTool !== 'select') {
        setActiveTool('select');
      }
    };

    const restoreTool = () => {
      if (!shiftSelectActiveRef.current) {
        return;
      }

      shiftSelectActiveRef.current = false;
      const previousTool = previousToolRef.current;
      if (previousTool && previousTool !== activeTool) {
        setActiveTool(previousTool);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Shift') {
        return;
      }

      restoreTool();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', restoreTool);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', restoreTool);
    };
  }, [activeTool, setActiveTool]);

  useEffect(() => {
    const persistedPlans = readPersistedPlans();
    const activePlanId = persistedPlans.activePlanId ?? persistedPlans.plans[0]?.plan.id ?? null;

    if (activePlanId) {
      const persistedPlan = persistedPlans.plans.find((entry) => entry.plan.id === activePlanId)?.plan;
      if (persistedPlan) {
        loadPlan(persistedPlan);
      }
    }

    setIsHydrated(true);
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

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    setIsPlanSaving(true);
    const persistedPlans = upsertPersistedPlan(plan);
    if (!persistedPlans) {
      setPlanNotice({
        variant: 'error',
        message: 'Unable to save plan in local storage.',
      });
    }

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      setIsPlanSaving(false);
    }, 650);

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [isHydrated, plan]);

  useEffect(() => {
    return () => {
      if (zoomTimeoutRef.current) {
        window.clearTimeout(zoomTimeoutRef.current);
      }
    };
  }, []);

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
    setPlanNotice({
      variant: 'success',
      message: 'Created a new plan.',
    });
  };

  const openLoadPlanModal = () => {
    const persistedPlans = readPersistedPlans();
    const summaries = listSavedPlanSummaries(persistedPlans);
    const activePlanId =
      persistedPlans.activePlanId ?? summaries[0]?.id ?? null;

    setSavedPlans(summaries);
    setSelectedSavedPlanId(activePlanId);
    setIsLoadPlanOpen(true);
  };

  const formatSavedTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.valueOf())) {
      return timestamp;
    }
    return date.toLocaleString();
  };

  const handleLoadPlan = () => {
    if (!selectedSavedPlanId) {
      setPlanNotice({
        variant: 'error',
        message: 'Select a saved plan to load.',
      });
      return;
    }

    const loadedPlan = getPersistedPlanById(selectedSavedPlanId);
    if (!loadedPlan) {
      setPlanNotice({
        variant: 'error',
        message: 'Saved plan was not found in local storage.',
      });
      return;
    }

    loadPlan(loadedPlan);
    setIsLoadPlanOpen(false);
    setPlanNotice({
      variant: 'success',
      message: `Loaded "${loadedPlan.name}".`,
    });
  };

  const handleCloseLoadPlan = () => {
    setIsLoadPlanOpen(false);
  };

  const handleLoadButtonClick = () => {
    openLoadPlanModal();
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

    setIsZoomIndicatorVisible(true);
    if (zoomTimeoutRef.current) {
      window.clearTimeout(zoomTimeoutRef.current);
    }
    zoomTimeoutRef.current = window.setTimeout(() => {
      setIsZoomIndicatorVisible(false);
    }, 5000);
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

    let activeStampId = stamp.id;
    let activeStamp = stamp;

    if (event.altKey && stamp.id === selectedStampId) {
      const duplicatedStampId = stampElement(stamp.elementId, { x: stamp.x, y: stamp.y });
      if (duplicatedStampId) {
        activeStampId = duplicatedStampId;
        activeStamp = { ...stamp, id: duplicatedStampId };
      }
    }

    selectStamp(activeStampId);
    selectElement(stamp.elementId);
    setDragState({
      stampId: activeStampId,
      offsetX: point.x - activeStamp.x,
      offsetY: point.y - activeStamp.y,
      startX: activeStamp.x,
      startY: activeStamp.y,
    });
    setDragPreview({
      stampId: activeStampId,
      x: activeStamp.x,
      y: activeStamp.y,
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
  const selectedElementName = selectedElement?.name ?? 'None';
  const backgroundUploadLabel = backgroundImage ? 'Choose new background image' : 'choose file';

  return (
      <div className="app-shell">
          <aside className="left-toolbar" aria-label="Editor tools">
              <h2 className="region-title">Tools</h2>
              <div className="toolbar-group">
                  {toolButtons.map((tool) => (
                      <button
                          key={tool.id}
                          type="button"
                          className={
                              activeTool === tool.id
                                  ? "tool-button active"
                                  : "tool-button"
                          }
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
                  <button
                      type="button"
                      className="tool-button"
                      onClick={handleBringToFront}
                      disabled={!selectedStampId}
                  >
                      Bring to Front
                  </button>
                  <button
                      type="button"
                      className="tool-button"
                      onClick={handleSendToBack}
                      disabled={!selectedStampId}
                  >
                      Send to Back
                  </button>
                  <button
                      type="button"
                      className="tool-button"
                      onClick={handleResizeAction}
                      disabled={!selectedElement}
                  >
                      Resize Element
                  </button>
              </div>
          </aside>

          <main className="editor-area">
              <section className="canvas-region" aria-label="Canvas area">
                  <div
                      ref={canvasSurfaceRef}
                      className={
                          activeTool === "stamp"
                              ? "canvas-surface stamp-mode-surface"
                              : "canvas-surface"
                      }
                      onPointerDown={handleCanvasPointerDown}
                      onWheel={handleCanvasWheel}
                  >
                      <div
                          className="canvas-viewport"
                          style={viewportTransformStyle}
                      >
                          {backgroundImage ? (
                              <img
                                  src={backgroundImage}
                                  alt="Plan background"
                                  className="canvas-background-image"
                              />
                          ) : (
                              <p className="canvas-empty-state">
                                  Upload a background image (under{" "}
                                  {BACKGROUND_IMAGE_MAX_MB}MB) to start your
                                  layout.
                              </p>
                          )}
                          <div
                              className={
                                  activeTool === "stamp"
                                      ? "stamp-layer stamp-layer-disabled"
                                      : "stamp-layer"
                              }
                          >
                              {sortedStamps.map((stamp) => {
                                  const stampElementDefinition =
                                      elementsById.get(stamp.elementId);
                                  if (!stampElementDefinition) {
                                      return null;
                                  }

                                  const previewPosition =
                                      dragPreview &&
                                      dragPreview.stampId === stamp.id
                                          ? {
                                                x: dragPreview.x,
                                                y: dragPreview.y,
                                            }
                                          : { x: stamp.x, y: stamp.y };
                                  const effectiveScale =
                                      resizeState &&
                                      resizeState.elementId === stamp.elementId
                                          ? resizeState.previewScale
                                          : stampElementDefinition.scale;
                                  const stampSize =
                                      effectiveScale * STAMP_BASE_SIZE;
                                  const isSelected =
                                      stamp.id === selectedStampId;
                                  const isDragging =
                                      dragState?.stampId === stamp.id;
                                  const stampShapeColor = getColorHex(
                                      stampElementDefinition.color,
                                  );

                                  return (
                                      <button
                                          key={stamp.id}
                                          type="button"
                                          className={
                                              isSelected
                                                  ? isDragging
                                                      ? "stamp-item selected dragging"
                                                      : "stamp-item selected"
                                                  : "stamp-item"
                                          }
                                          style={
                                              {
                                                  width: `${stampSize}px`,
                                                  height: `${stampSize}px`,
                                                  left: `${previewPosition.x - stampSize / 2}px`,
                                                  top: `${previewPosition.y - stampSize / 2}px`,
                                                  zIndex: stamp.zIndex + 100,
                                                  "--stamp-outline-color":
                                                      stampShapeColor,
                                              } as CSSProperties
                                          }
                                          data-stamp-id={stamp.id}
                                          onPointerDown={(event) =>
                                              handleStampPointerDown(
                                                  event,
                                                  stamp,
                                              )
                                          }
                                          aria-label={`Stamp ${stampElementDefinition.name}`}
                                      >
                                      {renderShape(
                                          stampElementDefinition.shapeId,
                                          stampShapeColor,
                                          "stamp-shape",
                                      )}
                                          {isSelected && resizeMode ? (
                                              <div className="resize-handle-layer">
                                                  {(
                                                      [
                                                          "top",
                                                          "right",
                                                          "bottom",
                                                          "left",
                                                      ] as const
                                                  ).map((handle) => (
                                                      <span
                                                          key={handle}
                                                          className={`resize-handle handle-${handle}`}
                                                          onPointerDown={(
                                                              event,
                                                          ) =>
                                                              handleResizeHandlePointerDown(
                                                                  event,
                                                                  stamp,
                                                                  stampElementDefinition,
                                                                  handle,
                                                              )
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
                          {activeTool === "stamp"
                              ? "Stamp tool active: click anywhere in the canvas to place the selected element."
                              : resizeMode
                                ? "Resize mode active: drag the edge handles to scale the selected stamp from center."
                                : "Select tool active: click a stamp to select and drag it."}{" "}
                          Shift+Scroll zooms the canvas.
                      </p>
                      <div
                          className={
                              isZoomIndicatorVisible
                                  ? "canvas-zoom-indicator visible"
                                  : "canvas-zoom-indicator"
                          }
                      >
                          Zoom {Math.round(viewport.zoom * 100)}%
                      </div>
                  </div>
                  <div className="canvas-summary" role="status">
                      <div className="canvas-summary-item">
                          <span className="canvas-summary-label">Elements</span>
                          <span className="canvas-summary-value">
                              {elements.length}
                          </span>
                      </div>
                      <div className="canvas-summary-item">
                          <span className="canvas-summary-label">Stamps</span>
                          <span className="canvas-summary-value">
                              {stamps.length}
                          </span>
                      </div>
                      <div className="canvas-summary-item">
                          <span className="canvas-summary-label">
                              Selected element
                          </span>
                          <span className="canvas-summary-value">
                              {selectedElementName}
                          </span>
                      </div>
                      <div className="canvas-summary-item">
                          <span className="canvas-summary-label">
                              Selected size
                          </span>
                          <span className="canvas-summary-value">
                              {selectedStampSize
                                  ? `${selectedStampSize.toFixed(1)}px`
                                  : "None"}
                          </span>
                      </div>
                  </div>
              </section>
          </main>

          <aside className="right-panel" aria-label="Element details">
              <section className="panel-section plan-section">
                  <div className="section-header">
                      <h2 className="region-title">Plans</h2>
                  </div>
                  <label className="field-label" htmlFor="plan-name-input">
                      Plan name
                  </label>
                  <input
                      id="plan-name-input"
                      name="plan-name"
                      value={planName}
                      onChange={(event) => setPlanName(event.target.value)}
                  />
                  <div
                      className={
                          isPlanSaving
                              ? "plan-save-indicator saving"
                              : "plan-save-indicator saved"
                      }
                      role="status"
                      aria-live="polite"
                  >
                      <span className="plan-save-texts">
                          <span className="plan-save-text saved">
                              Plan Saved
                          </span>
                          <span className="plan-save-text saving">
                              Plan Saving 💾
                          </span>
                      </span>
                  </div>
                  <div className="file-field">
                      
                      <input
                          id="background-upload-input"
                          className="file-input"
                          type="file"
                          accept="image/*"
                          onChange={(event) => {
                              void handleBackgroundFileChange(event);
                          }}
                      />
                      <label
                          htmlFor="background-upload-input"
                          className="file-label"
                      >
                          <button
                          type="button"
                          className="tool-button panel-action"
                          onClick={() =>
                              document
                                  .getElementById("background-upload-input")
                                  ?.click()
                          }
                          >
                              {backgroundUploadLabel}
                          </button>
                      </label>
                  </div>
                  {backgroundUploadError ? (
                      <p className="error-note" role="status">
                          {backgroundUploadError}
                      </p>
                  ) : null}
                  <div className="plan-actions-grid">
                      <button
                          type="button"
                          className="tool-button panel-action"
                          onClick={handleCreateNewPlan}
                      >
                          Create New Plan
                      </button>
                      <button
                          type="button"
                          className="tool-button panel-action"
                          onClick={handleLoadButtonClick}
                      >
                          Load Plan
                      </button>
                  </div>
              </section>

              <section className="panel-section">
                  <div className="section-header">
                      <h2 className="region-title">Elements</h2>
                      <button
                          type="button"
                          className="tool-button panel-action"
                          onClick={handleAddElement}
                      >
                          Add Element
                      </button>
                  </div>
                  <ul className="element-list">
                      {elements.map((element) => (
                          <li key={element.id}>
                              <button
                                  type="button"
                                  className={
                                      element.id === selectedElementId
                                          ? "element-list-button selected"
                                          : "element-list-button"
                                  }
                                  onClick={() => selectElement(element.id)}
                              >
                                  <span
                                      className="element-preview"
                                      aria-hidden="true"
                                  >
                                      {renderShape(
                                          element.shapeId,
                                          getColorHex(element.color),
                                          "element-shape",
                                      )}
                                  </span>
                                  <span className="element-list-text">
                                      <span className="element-name">
                                          {element.name}
                                      </span>
                                      <span className="element-meta">
                                          {element.shapeId} - {element.color} -
                                          scale {formatScaleDisplay(element.scale)}
                                      </span>
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
                          <label
                              className="field-label"
                              htmlFor="element-name-input"
                          >
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
                          <div className="shape-picker-row">
                              <span
                                  className="element-preview"
                                  aria-hidden="true"
                              >
                                  {renderShape(
                                      selectedElement.shapeId,
                                      getColorHex(selectedElement.color),
                                      "element-shape",
                                  )}
                              </span>
                              <button
                                  type="button"
                                  className="tool-button panel-action"
                                  onClick={() => setIsShapePickerOpen(true)}
                              >
                                  Choose shape ({selectedElement.shapeId})
                              </button>
                          </div>

                          <span className="field-label">Color</span>
                          <div
                              className="color-swatch-grid"
                              role="listbox"
                              aria-label="Select a color"
                          >
                              {COLOR_OPTIONS.map((colorOption) => {
                                  const swatchHex = getColorHex(colorOption);
                                  const isSelected =
                                      selectedElement.color === colorOption;

                                  return (
                                      <button
                                          key={colorOption}
                                          type="button"
                                          className={
                                              isSelected
                                                  ? "color-swatch-button selected"
                                                  : "color-swatch-button"
                                          }
                                          style={
                                              {
                                                  "--swatch-color": swatchHex,
                                              } as CSSProperties
                                          }
                                          onClick={() =>
                                              updateElement(
                                                  selectedElement.id,
                                                  {
                                                      color: colorOption,
                                                  },
                                              )
                                          }
                                          aria-pressed={isSelected}
                                      >
                                          <span
                                              className="color-swatch-chip"
                                              aria-hidden="true"
                                          />
                                          <span className="color-swatch-label">
                                              {colorOption}
                                          </span>
                                      </button>
                                  );
                              })}
                          </div>

                          <label
                              className="field-label"
                              htmlFor="element-scale-input"
                          >
                              Scale
                          </label>
                          <input
                              id="element-scale-input"
                              type="number"
                              min={0.1}
                              step={0.1}
                              value={formatScaleDisplay(selectedElement.scale)}
                              onChange={(event) => {
                                  const nextScale = Number(event.target.value);
                                  if (
                                      Number.isFinite(nextScale) &&
                                      nextScale > 0
                                  ) {
                                      updateElement(selectedElement.id, {
                                          scale: truncateToDecimals(nextScale, 2),
                                      });
                                  }
                              }}
                          />

                          <button
                              type="button"
                              className="tool-button panel-action"
                              onClick={handleResizeAction}
                          >
                              Resize Element
                          </button>

                          <button
                              type="button"
                              className="tool-button danger-button panel-action"
                              onClick={handleDeleteElement}
                          >
                              Delete Element
                          </button>
                      </div>
                  ) : (
                      <p className="panel-note">
                          Add an element to begin editing.
                      </p>
                  )}
              </section>
          </aside>

          {planNotice ? (
              <div
                  className={
                      planNotice.variant === "error"
                          ? "plan-toast error"
                          : "plan-toast success"
                  }
                  role="status"
              >
                  {planNotice.message}
              </div>
          ) : null}

          {isLoadPlanOpen ? (
              <div
                  className="modal-backdrop"
                  role="presentation"
                  onClick={handleCloseLoadPlan}
              >
                  <div
                      className="load-plan-modal"
                      role="dialog"
                      aria-modal="true"
                      aria-label="Load a saved plan"
                      onClick={(event) => event.stopPropagation()}
                  >
                      <h2>Load a plan</h2>
                      {savedPlans.length ? (
                          <div className="saved-plan-list" role="listbox">
                              {savedPlans.map((planSummary) => (
                                  <button
                                      key={planSummary.id}
                                      type="button"
                                      className={
                                          planSummary.id ===
                                          selectedSavedPlanId
                                              ? "tool-button saved-plan-button selected"
                                              : "tool-button saved-plan-button"
                                      }
                                      onClick={() =>
                                          setSelectedSavedPlanId(
                                              planSummary.id,
                                          )
                                      }
                                      aria-pressed={
                                          planSummary.id ===
                                          selectedSavedPlanId
                                      }
                                  >
                                      <span className="saved-plan-name">
                                          {planSummary.name}
                                      </span>
                                      <span className="saved-plan-meta">
                                          {formatSavedTimestamp(
                                              planSummary.savedAt,
                                          )}
                                      </span>
                                  </button>
                              ))}
                          </div>
                      ) : (
                          <p className="panel-note">
                              No saved plans found yet.
                          </p>
                      )}
                      <div className="modal-actions">
                          <button
                              type="button"
                              className="tool-button panel-action"
                              onClick={handleLoadPlan}
                              disabled={!selectedSavedPlanId}
                          >
                              Load Selected
                          </button>
                          <button
                              type="button"
                              className="tool-button panel-action"
                              onClick={handleCloseLoadPlan}
                          >
                              Cancel
                          </button>
                      </div>
                  </div>
              </div>
          ) : null}

          {isShapePickerOpen && selectedElement ? (
              <div
                  className="modal-backdrop"
                  role="presentation"
                  onClick={() => setIsShapePickerOpen(false)}
              >
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
                                          ? "tool-button shape-option active-shape"
                                          : "tool-button shape-option"
                                  }
                                  aria-label={shapeOption}
                                  title={shapeOption}
                                  onClick={() => {
                                      updateElement(selectedElement.id, {
                                          shapeId: shapeOption,
                                      });
                                      setIsShapePickerOpen(false);
                                  }}
                              >
                                  {renderShape(
                                      shapeOption,
                                      getColorHex(selectedElement.color),
                                      "shape-option-preview",
                                  )}
                              </button>
                          ))}
                      </div>
                      <button
                          type="button"
                          className="tool-button panel-action"
                          onClick={() => setIsShapePickerOpen(false)}
                      >
                          Close
                      </button>
                  </div>
              </div>
          ) : null}
      </div>
  );
}

export default App;
