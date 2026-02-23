import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { createStore, type StateCreator } from 'zustand/vanilla';

import {
  HISTORY_LIMIT,
  SHAPE_OPTIONS,
  type HistoryEntry,
  type HistorySnapshot,
  type LandscaperState,
  type LandscaperStore,
  type Plan,
  type PlanElement,
  type Stamp,
  type UiState,
} from './types';

const SEEDED_ELEMENT_ID = 'element-seeded-shrub';
const PLAN_ID = 'plan-localhost';

const createPlanId = (() => {
  let counter = 0;
  return () => {
    counter += 1;
    return `plan-${Date.now().toString(36)}-${counter.toString(36)}`;
  };
})();

const buildSeededElement = (): PlanElement => ({
  id: SEEDED_ELEMENT_ID,
  name: 'Shrub',
  shapeId: SHAPE_OPTIONS[0],
  color: 'Pine',
  scale: 1,
});

const createPlan = (id: string, name = 'Untitled Plan'): Plan => ({
  id,
  name,
  backgroundImage: null,
  elements: [buildSeededElement()],
  stamps: [],
  viewport: {
    zoom: 1,
    panX: 0,
    panY: 0,
  },
});

const initialPlan = (): Plan => createPlan(PLAN_ID);

const cloneElements = (elements: PlanElement[]): PlanElement[] =>
  elements.map((element) => ({ ...element }));

const cloneStamps = (stamps: Stamp[]): Stamp[] => stamps.map((stamp) => ({ ...stamp }));

const clonePlan = (plan: Plan): Plan => ({
  ...plan,
  elements: cloneElements(plan.elements),
  stamps: cloneStamps(plan.stamps),
  viewport: { ...plan.viewport },
});

const cloneUi = (ui: UiState): UiState => ({
  activeTool: ui.activeTool,
  selectedElementId: ui.selectedElementId,
  selection: { ...ui.selection },
});

const createUiStateForPlan = (plan: Plan): UiState => ({
  activeTool: 'stamp',
  selectedElementId: plan.elements[0]?.id ?? null,
  selection: {
    selectedStampId: null,
    resizeMode: false,
  },
});

const historyEntryId = (() => {
  let current = 0;
  return () => {
    current += 1;
    return `history-${current}`;
  };
})();

const createStampId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `stamp-${crypto.randomUUID()}`;
  }

  return `stamp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const clampZIndexBase = (stamps: Stamp[]): number => {
  if (stamps.length === 0) {
    return 0;
  }

  return Math.max(...stamps.map((stamp) => stamp.zIndex));
};

const createHistoryEntry = (state: LandscaperState, label: string): HistoryEntry => ({
  id: historyEntryId(),
  label,
  timestamp: new Date().toISOString(),
  snapshot: {
    plan: clonePlan(state.plan),
    ui: cloneUi(state.ui),
  },
});

const restoreFromSnapshot = (snapshot: HistorySnapshot, currentViewport: Plan['viewport']) => ({
  plan: {
    ...clonePlan(snapshot.plan),
    viewport: { ...currentViewport },
  },
  ui: cloneUi(snapshot.ui),
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

const createInitialState = (): LandscaperState => {
  const plan = initialPlan();

  return {
    plan,
    ui: createUiStateForPlan(plan),
    history: {
      past: [],
      future: [],
      limit: HISTORY_LIMIT,
    },
  };
};

const storeCreator: StateCreator<LandscaperStore> = (set) => ({
  ...createInitialState(),

  createNewPlan: (name = 'Untitled Plan') => {
    let nextPlanId = '';

    set(
      (state) => {
        const createdPlan = createPlan(createPlanId(), name);
        nextPlanId = createdPlan.id;

        return {
          ...state,
          plan: createdPlan,
          ui: createUiStateForPlan(createdPlan),
          history: {
            ...state.history,
            past: [],
            future: [],
          },
        };
      },
      false,
      'plan/createNew',
    );

    return nextPlanId;
  },

  loadPlan: (plan) =>
    set(
      (state) => {
        const loadedPlan = clonePlan(plan);

        return {
          ...state,
          plan: loadedPlan,
          ui: createUiStateForPlan(loadedPlan),
          history: {
            ...state.history,
            past: [],
            future: [],
          },
        };
      },
      false,
      'plan/load',
    ),

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
      (state) => {
        const nextViewport = {
          ...state.plan.viewport,
          ...viewport,
        };
        if (
          nextViewport.zoom === state.plan.viewport.zoom &&
          nextViewport.panX === state.plan.viewport.panX &&
          nextViewport.panY === state.plan.viewport.panY
        ) {
          return state;
        }

        return {
          ...state,
          plan: {
            ...state.plan,
            viewport: nextViewport,
          },
        };
      },
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

  stampElement: (elementId, position) => {
    let createdStampId: string | null = null;

    set(
      (state) => {
        if (!state.plan.elements.some((element) => element.id === elementId)) {
          return state;
        }

        createdStampId = createStampId();

        return {
          ...state,
          history: appendHistory(state, 'Stamp element'),
          plan: {
            ...state.plan,
            stamps: [
              ...state.plan.stamps,
              {
                id: createdStampId,
                elementId,
                x: position.x,
                y: position.y,
                zIndex: clampZIndexBase(state.plan.stamps) + 1,
              },
            ],
          },
        };
      },
      false,
      'stamps/stampElement',
    );

    return createdStampId;
  },

  moveStamp: (stampId, position) =>
    set(
      (state) => {
        const existingStamp = state.plan.stamps.find((stamp) => stamp.id === stampId);
        if (!existingStamp) {
          return state;
        }

        if (existingStamp.x === position.x && existingStamp.y === position.y) {
          return state;
        }

        return {
          ...state,
          history: appendHistory(state, 'Move stamp'),
          plan: {
            ...state.plan,
            stamps: state.plan.stamps.map((stamp) =>
              stamp.id === stampId
                ? {
                    ...stamp,
                    x: position.x,
                    y: position.y,
                  }
                : stamp,
            ),
          },
        };
      },
      false,
      'stamps/move',
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

  deleteStamp: (stampId) =>
    set(
      (state) => {
        if (!state.plan.stamps.some((stamp) => stamp.id === stampId)) {
          return state;
        }

        const remainingStamps = state.plan.stamps.filter((stamp) => stamp.id !== stampId);
        const isSelected = state.ui.selection.selectedStampId === stampId;

        return {
          ...state,
          history: appendHistory(state, 'Delete stamp'),
          plan: {
            ...state.plan,
            stamps: remainingStamps,
          },
          ui: {
            ...state.ui,
            selection: {
              ...state.ui.selection,
              selectedStampId: isSelected ? null : state.ui.selection.selectedStampId,
              resizeMode: isSelected ? false : state.ui.selection.resizeMode,
            },
          },
        };
      },
      false,
      'stamps/delete',
    ),

  bringStampToFront: (stampId) =>
    set(
      (state) => {
        const targetStamp = state.plan.stamps.find((stamp) => stamp.id === stampId);
        if (!targetStamp) {
          return state;
        }

        const maxZIndex = clampZIndexBase(state.plan.stamps);
        if (targetStamp.zIndex >= maxZIndex) {
          return state;
        }

        const nextZIndex = maxZIndex + 1;
        return {
          ...state,
          history: appendHistory(state, 'Bring stamp to front'),
          plan: {
            ...state.plan,
            stamps: state.plan.stamps.map((stamp) =>
              stamp.id === stampId
                ? {
                    ...stamp,
                    zIndex: nextZIndex,
                  }
                : stamp,
            ),
          },
        };
      },
      false,
      'stamps/bringToFront',
    ),

  sendStampToBack: (stampId) =>
    set(
      (state) => {
        const targetStamp = state.plan.stamps.find((stamp) => stamp.id === stampId);
        if (!targetStamp) {
          return state;
        }

        const minZIndex = Math.min(...state.plan.stamps.map((stamp) => stamp.zIndex));
        if (targetStamp.zIndex <= minZIndex) {
          return state;
        }

        const nextZIndex = minZIndex - 1;
        return {
          ...state,
          history: appendHistory(state, 'Send stamp to back'),
          plan: {
            ...state.plan,
            stamps: state.plan.stamps.map((stamp) =>
              stamp.id === stampId
                ? {
                    ...stamp,
                    zIndex: nextZIndex,
                  }
                : stamp,
            ),
          },
        };
      },
      false,
      'stamps/sendToBack',
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

  undo: () =>
    set(
      (state) => {
        const previousEntry = state.history.past.at(-1);
        if (!previousEntry) {
          return state;
        }

        const currentEntry = createHistoryEntry(state, `Redo ${previousEntry.label}`);
        const restoredSnapshot = restoreFromSnapshot(previousEntry.snapshot, state.plan.viewport);

        return {
          ...state,
          ...restoredSnapshot,
          history: {
            ...state.history,
            past: state.history.past.slice(0, -1),
            future: [currentEntry, ...state.history.future].slice(0, state.history.limit),
          },
        };
      },
      false,
      'history/undo',
    ),

  redo: () =>
    set(
      (state) => {
        const nextEntry = state.history.future[0];
        if (!nextEntry) {
          return state;
        }

        const currentEntry = createHistoryEntry(state, `Undo ${nextEntry.label}`);
        const restoredSnapshot = restoreFromSnapshot(nextEntry.snapshot, state.plan.viewport);

        return {
          ...state,
          ...restoredSnapshot,
          history: {
            ...state.history,
            past: [...state.history.past, currentEntry].slice(-state.history.limit),
            future: state.history.future.slice(1),
          },
        };
      },
      false,
      'history/redo',
    ),
});

export const createLandscaperStore = () => createStore<LandscaperStore>()(storeCreator);

export const useLandscaperStore = create<LandscaperStore>()(
  devtools(storeCreator, { name: 'landscaper-store' }),
);

export { SEEDED_ELEMENT_ID, PLAN_ID };
