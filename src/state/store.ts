import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createStore, type StateCreator } from 'zustand/vanilla';

import {
  HISTORY_LIMIT,
  type HistoryEntry,
  type LandscaperState,
  type LandscaperStore,
  type Plan,
  type PlanElement,
  type Stamp,
} from './types';

const SEEDED_ELEMENT_ID = 'element-seeded-shrub';
const PLAN_ID = 'plan-localhost';

const initialPlan = (): Plan => ({
  id: PLAN_ID,
  name: 'Untitled Plan',
  backgroundImage: null,
  elements: [
    {
      id: SEEDED_ELEMENT_ID,
      name: 'Shrub',
      shapeId: 'shrub',
      color: 'Green',
      scale: 1,
    },
  ],
  stamps: [],
  viewport: {
    zoom: 1,
    panX: 0,
    panY: 0,
  },
});

const cloneElements = (elements: PlanElement[]): PlanElement[] =>
  elements.map((element) => ({ ...element }));

const cloneStamps = (stamps: Stamp[]): Stamp[] => stamps.map((stamp) => ({ ...stamp }));

const clonePlan = (plan: Plan): Plan => ({
  ...plan,
  elements: cloneElements(plan.elements),
  stamps: cloneStamps(plan.stamps),
  viewport: { ...plan.viewport },
});

const historyEntryId = (() => {
  let current = 0;
  return () => {
    current += 1;
    return `history-${current}`;
  };
})();

const createHistoryEntry = (state: LandscaperState, label: string): HistoryEntry => ({
  id: historyEntryId(),
  label,
  timestamp: new Date().toISOString(),
  snapshot: {
    plan: clonePlan(state.plan),
    ui: {
      activeTool: state.ui.activeTool,
      selectedElementId: state.ui.selectedElementId,
      selection: { ...state.ui.selection },
    },
  },
});

const appendHistory = (state: LandscaperState, label: string) => {
  const entry = createHistoryEntry(state, label);
  const past = [...state.history.past, entry];

  return {
    ...state.history,
    past: past.slice(-state.history.limit),
    future: [],
  };
};

const createInitialState = (): LandscaperState => ({
  plan: initialPlan(),
  ui: {
    activeTool: 'select',
    selectedElementId: SEEDED_ELEMENT_ID,
    selection: {
      selectedStampId: null,
      resizeMode: false,
    },
  },
  history: {
    past: [],
    future: [],
    limit: HISTORY_LIMIT,
  },
});

const storeCreator: StateCreator<LandscaperStore> = (set) => ({
  ...createInitialState(),

  setPlanName: (name) =>
    set(
      (state) => ({
        ...state,
        history: appendHistory(state, 'Rename plan'),
        plan: {
          ...state.plan,
          name,
        },
      }),
      false,
      'plan/setName',
    ),

  setBackgroundImage: (backgroundImage) =>
    set(
      (state) => ({
        ...state,
        history: appendHistory(state, 'Set background image'),
        plan: {
          ...state.plan,
          backgroundImage,
        },
      }),
      false,
      'plan/setBackgroundImage',
    ),

  setViewport: (viewport) =>
    set(
      (state) => ({
        ...state,
        history: appendHistory(state, 'Adjust viewport'),
        plan: {
          ...state.plan,
          viewport: {
            ...state.plan.viewport,
            ...viewport,
          },
        },
      }),
      false,
      'plan/setViewport',
    ),

  addElement: (element) =>
    set(
      (state) => ({
        ...state,
        history: appendHistory(state, 'Add element'),
        plan: {
          ...state.plan,
          elements: [...state.plan.elements, element],
        },
      }),
      false,
      'elements/add',
    ),

  updateElement: (elementId, updates) =>
    set(
      (state) => ({
        ...state,
        history: appendHistory(state, 'Update element'),
        plan: {
          ...state.plan,
          elements: state.plan.elements.map((element) =>
            element.id === elementId ? { ...element, ...updates } : element,
          ),
        },
      }),
      false,
      'elements/update',
    ),

  deleteElement: (elementId) =>
    set(
      (state) => {
        if (!state.plan.elements.some((element) => element.id === elementId)) {
          return state;
        }

        const remainingElements = state.plan.elements.filter((element) => element.id !== elementId);
        const removedStampIds = new Set(
          state.plan.stamps
            .filter((stamp) => stamp.elementId === elementId)
            .map((stamp) => stamp.id),
        );
        const remainingStamps = state.plan.stamps.filter((stamp) => stamp.elementId !== elementId);

        return {
          ...state,
          history: appendHistory(state, 'Delete element'),
          plan: {
            ...state.plan,
            elements: remainingElements,
            stamps: remainingStamps,
          },
          ui: {
            ...state.ui,
            selectedElementId:
              state.ui.selectedElementId === elementId
                ? (remainingElements[0]?.id ?? null)
                : state.ui.selectedElementId,
            selection: {
              ...state.ui.selection,
              selectedStampId:
                state.ui.selection.selectedStampId &&
                removedStampIds.has(state.ui.selection.selectedStampId)
                  ? null
                  : state.ui.selection.selectedStampId,
            },
          },
        };
      },
      false,
      'elements/delete',
    ),

  addStamp: (stamp) =>
    set(
      (state) => ({
        ...state,
        history: appendHistory(state, 'Add stamp'),
        plan: {
          ...state.plan,
          stamps: [...state.plan.stamps, stamp],
        },
      }),
      false,
      'stamps/add',
    ),

  updateStamp: (stampId, updates) =>
    set(
      (state) => ({
        ...state,
        history: appendHistory(state, 'Update stamp'),
        plan: {
          ...state.plan,
          stamps: state.plan.stamps.map((stamp) =>
            stamp.id === stampId ? { ...stamp, ...updates } : stamp,
          ),
        },
      }),
      false,
      'stamps/update',
    ),

  setActiveTool: (tool) =>
    set(
      (state) => ({
        ...state,
        ui: {
          ...state.ui,
          activeTool: tool,
        },
      }),
      false,
      'ui/setActiveTool',
    ),

  selectStamp: (stampId) =>
    set(
      (state) => ({
        ...state,
        ui: {
          ...state.ui,
          selection: {
            ...state.ui.selection,
            selectedStampId: stampId,
          },
        },
      }),
      false,
      'ui/selectStamp',
    ),

  selectElement: (elementId) =>
    set(
      (state) => ({
        ...state,
        ui: {
          ...state.ui,
          selectedElementId: elementId,
        },
      }),
      false,
      'ui/selectElement',
    ),

  setResizeMode: (isEnabled) =>
    set(
      (state) => ({
        ...state,
        ui: {
          ...state.ui,
          selection: {
            ...state.ui.selection,
            resizeMode: isEnabled,
          },
        },
      }),
      false,
      'ui/setResizeMode',
    ),

  pushHistoryCheckpoint: (label) =>
    set(
      (state) => ({
        ...state,
        history: appendHistory(state, label),
      }),
      false,
      'history/pushCheckpoint',
    ),
});

export const createLandscaperStore = () => createStore<LandscaperStore>()(storeCreator);

export const useLandscaperStore = create<LandscaperStore>()(
  devtools(storeCreator, { name: 'landscaper-store' }),
);

export { SEEDED_ELEMENT_ID, PLAN_ID };
