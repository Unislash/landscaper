export const LOCAL_STORAGE_KEY = 'landscaper.plans.v1';
export const HISTORY_LIMIT = 100;
export const MAX_BACKGROUND_IMAGE_BYTES = 9 * 1024 * 1024;

export const SHAPE_OPTIONS = ['circle', 'square', 'triangle', 'shrub'] as const;
export type ShapeId = (typeof SHAPE_OPTIONS)[number];

export const COLOR_OPTIONS = ['Green', 'Dark Green', 'Brown', 'Gray', 'Blue'] as const;
export type ElementColor = (typeof COLOR_OPTIONS)[number];

export type ToolMode = 'select';

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface PlanElement {
  id: string;
  name: string;
  shapeId: ShapeId;
  color: ElementColor;
  scale: number;
}

export interface Stamp {
  id: string;
  elementId: string;
  x: number;
  y: number;
  zIndex: number;
}

export interface Plan {
  id: string;
  name: string;
  backgroundImage: string | null;
  elements: PlanElement[];
  stamps: Stamp[];
  viewport: Viewport;
}

export interface SelectionState {
  selectedStampId: string | null;
  resizeMode: boolean;
}

export interface UiState {
  activeTool: ToolMode;
  selection: SelectionState;
  selectedElementId: string | null;
}

export interface HistorySnapshot {
  plan: Plan;
  ui: UiState;
}

export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: string;
  snapshot: HistorySnapshot;
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  limit: number;
}

export interface LandscaperState {
  plan: Plan;
  ui: UiState;
  history: HistoryState;
}

export interface PlanMutations {
  setPlanName: (name: string) => void;
  setBackgroundImage: (backgroundImage: string | null) => void;
  setViewport: (viewport: Partial<Viewport>) => void;
}

export interface ElementMutations {
  addElement: (element: PlanElement) => void;
  updateElement: (
    elementId: string,
    updates: Partial<Omit<PlanElement, 'id'>>,
  ) => void;
  deleteElement: (elementId: string) => void;
}

export interface StampMutations {
  addStamp: (stamp: Stamp) => void;
  updateStamp: (
    stampId: string,
    updates: Partial<Omit<Stamp, 'id' | 'elementId'>>,
  ) => void;
}

export interface UiMutations {
  setActiveTool: (tool: ToolMode) => void;
  selectStamp: (stampId: string | null) => void;
  selectElement: (elementId: string | null) => void;
  setResizeMode: (isEnabled: boolean) => void;
}

export interface HistoryMutations {
  pushHistoryCheckpoint: (label: string) => void;
}

export type LandscaperActions = PlanMutations &
  ElementMutations &
  StampMutations &
  UiMutations &
  HistoryMutations;

export type LandscaperStore = LandscaperState & LandscaperActions;
