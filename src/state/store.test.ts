import { beforeEach, describe, expect, it } from 'vitest';

import { createLandscaperStore, SEEDED_ELEMENT_ID } from './store';
import type { LandscaperStore } from './types';

describe('landscaper store foundation', () => {
  let store: ReturnType<typeof createLandscaperStore>;

  beforeEach(() => {
    store = createLandscaperStore();
  });

  it('starts with a seeded plan, UI state, and empty history', () => {
    const state = store.getState();

    expect(state.plan.name).toBe('Untitled Plan');
    expect(state.plan.backgroundImage).toBeNull();
    expect(state.plan.elements).toEqual([
      expect.objectContaining({
        id: SEEDED_ELEMENT_ID,
        name: 'Shrub',
        shapeId: 'plant01_big_leaf_dark',
      }),
    ]);
    expect(state.ui.selection.selectedStampId).toBeNull();
    expect(state.ui.selectedElementId).toBe(SEEDED_ELEMENT_ID);
    expect(state.ui.activeTool).toBe('stamp');
    expect(state.history.past).toHaveLength(0);
    expect(state.history.future).toHaveLength(0);
  });

  it('renames plan and records a history checkpoint', () => {
    store.getState().setPlanName('Front Yard Draft');

    const state = store.getState();
    expect(state.plan.name).toBe('Front Yard Draft');
    expect(state.history.past).toHaveLength(1);
    expect(state.history.past[0]?.label).toBe('Rename plan');
    expect(state.history.past[0]?.snapshot.plan.name).toBe('Untitled Plan');
  });

  it('updates element fields and captures prior state in history', () => {
    const elementId = store.getState().plan.elements[0]?.id;
    if (!elementId) {
      throw new Error('Seeded element not found');
    }

    store.getState().updateElement(elementId, {
      color: 'Walnut',
      scale: 1.25,
    });

    const state = store.getState();
    expect(state.plan.elements[0]?.color).toBe('Walnut');
    expect(state.plan.elements[0]?.scale).toBe(1.25);
    expect(state.history.past).toHaveLength(1);
    expect(state.history.past[0]?.snapshot.plan.elements[0]?.color).toBe('Pine');
  });

  it('clears redo history when a new mutation is applied', () => {
    const stampId = 'stamp-1';
    store.getState().setPlanName('Future Seed');
    const stateBeforeMutation = store.getState();
    const fakeFutureEntry = stateBeforeMutation.history.past[0];

    store.setState((state: LandscaperStore) => ({
      ...state,
      history: {
        ...state.history,
        future: fakeFutureEntry ? [fakeFutureEntry] : [],
      },
    }));

    store.getState().addStamp({
      id: stampId,
      elementId: SEEDED_ELEMENT_ID,
      x: 200,
      y: 150,
      zIndex: 1,
    });

    const state = store.getState();
    expect(state.plan.stamps).toHaveLength(1);
    expect(state.plan.stamps[0]?.id).toBe(stampId);
    expect(state.history.future).toHaveLength(0);
  });

  it('selects an element for detail editing', () => {
    store.getState().addElement({
      id: 'element-bed',
      name: 'Flower Bed',
      shapeId: 'plant03_big_spiky',
      color: 'Walnut',
      scale: 1.1,
    });

    store.getState().selectElement('element-bed');

    const state = store.getState();
    expect(state.ui.selectedElementId).toBe('element-bed');
  });

  it('deletes an element, removes related stamps, and records history', () => {
    store.getState().addElement({
      id: 'element-bed',
      name: 'Flower Bed',
      shapeId: 'plant03_big_spiky',
      color: 'Walnut',
      scale: 1.1,
    });
    store.getState().addStamp({
      id: 'stamp-bed-1',
      elementId: 'element-bed',
      x: 100,
      y: 120,
      zIndex: 1,
    });
    store.getState().addStamp({
      id: 'stamp-shrub-1',
      elementId: SEEDED_ELEMENT_ID,
      x: 220,
      y: 200,
      zIndex: 2,
    });
    store.getState().selectElement('element-bed');
    store.getState().selectStamp('stamp-bed-1');

    store.getState().deleteElement('element-bed');

    const state = store.getState();
    expect(state.plan.elements.map((element) => element.id)).toEqual([SEEDED_ELEMENT_ID]);
    expect(state.plan.stamps.map((stamp) => stamp.id)).toEqual(['stamp-shrub-1']);
    expect(state.ui.selectedElementId).toBe(SEEDED_ELEMENT_ID);
    expect(state.ui.selection.selectedStampId).toBeNull();
    expect(state.history.past.at(-1)?.label).toBe('Delete element');
  });

  it('stamps selected element and returns stamp id with front-most z-index', () => {
    const firstStampId = store.getState().stampElement(SEEDED_ELEMENT_ID, { x: 120, y: 160 });
    const secondStampId = store.getState().stampElement(SEEDED_ELEMENT_ID, { x: 180, y: 210 });

    const state = store.getState();
    expect(firstStampId).toBeTruthy();
    expect(secondStampId).toBeTruthy();
    expect(state.plan.stamps).toHaveLength(2);
    expect(state.plan.stamps[0]?.zIndex).toBe(1);
    expect(state.plan.stamps[1]?.zIndex).toBe(2);
    expect(state.history.past.at(-1)?.label).toBe('Stamp element');
  });

  it('moves a stamp in canvas coordinates and records history', () => {
    const stampId = store.getState().stampElement(SEEDED_ELEMENT_ID, { x: 100, y: 100 });
    if (!stampId) {
      throw new Error('Expected stamp id');
    }

    store.getState().moveStamp(stampId, { x: 245, y: 180 });

    const state = store.getState();
    expect(state.plan.stamps[0]?.x).toBe(245);
    expect(state.plan.stamps[0]?.y).toBe(180);
    expect(state.history.past.at(-1)?.label).toBe('Move stamp');
  });

  it('supports bringing a stamp to front and sending it to back', () => {
    const first = store.getState().stampElement(SEEDED_ELEMENT_ID, { x: 100, y: 100 });
    const second = store.getState().stampElement(SEEDED_ELEMENT_ID, { x: 130, y: 130 });
    if (!first || !second) {
      throw new Error('Expected created stamp ids');
    }

    store.getState().bringStampToFront(first);
    let state = store.getState();
    const firstAfterFront = state.plan.stamps.find((stamp) => stamp.id === first);
    const secondAfterFront = state.plan.stamps.find((stamp) => stamp.id === second);
    expect(firstAfterFront?.zIndex).toBeGreaterThan(secondAfterFront?.zIndex ?? 0);
    expect(state.history.past.at(-1)?.label).toBe('Bring stamp to front');

    store.getState().sendStampToBack(first);
    state = store.getState();
    const firstAfterBack = state.plan.stamps.find((stamp) => stamp.id === first);
    const secondAfterBack = state.plan.stamps.find((stamp) => stamp.id === second);
    expect(firstAfterBack?.zIndex).toBeLessThan(secondAfterBack?.zIndex ?? 0);
    expect(state.history.past.at(-1)?.label).toBe('Send stamp to back');
  });

  it('undo and redo restore plan snapshots', () => {
    store.getState().setPlanName('Front Plan');
    const stampId = store.getState().stampElement(SEEDED_ELEMENT_ID, { x: 210, y: 190 });
    if (!stampId) {
      throw new Error('Expected stamp id');
    }

    let state = store.getState();
    expect(state.plan.name).toBe('Front Plan');
    expect(state.plan.stamps).toHaveLength(1);
    expect(state.history.past).toHaveLength(2);
    expect(state.history.future).toHaveLength(0);

    store.getState().undo();
    state = store.getState();
    expect(state.plan.name).toBe('Front Plan');
    expect(state.plan.stamps).toHaveLength(0);
    expect(state.history.past).toHaveLength(1);
    expect(state.history.future).toHaveLength(1);

    store.getState().undo();
    state = store.getState();
    expect(state.plan.name).toBe('Untitled Plan');
    expect(state.history.past).toHaveLength(0);
    expect(state.history.future).toHaveLength(2);

    store.getState().redo();
    state = store.getState();
    expect(state.plan.name).toBe('Front Plan');
    expect(state.plan.stamps).toHaveLength(0);
    expect(state.history.past).toHaveLength(1);
    expect(state.history.future).toHaveLength(1);

    store.getState().redo();
    state = store.getState();
    expect(state.plan.name).toBe('Front Plan');
    expect(state.plan.stamps).toHaveLength(1);
    expect(state.history.past).toHaveLength(2);
    expect(state.history.future).toHaveLength(0);
  });

  it('does not push history entries for viewport-only zoom changes', () => {
    store.getState().setViewport({ zoom: 1.25 });

    const state = store.getState();
    expect(state.plan.viewport.zoom).toBe(1.25);
    expect(state.history.past).toHaveLength(0);
    expect(state.history.future).toHaveLength(0);
  });

  it('undo and redo are safe no-ops when stacks are empty', () => {
    store.getState().undo();
    store.getState().redo();

    const state = store.getState();
    expect(state.plan.name).toBe('Untitled Plan');
    expect(state.history.past).toHaveLength(0);
    expect(state.history.future).toHaveLength(0);
  });

  it('creates a new plan and clears history state', () => {
    store.getState().setPlanName('Before Reset');
    const newPlanId = store.getState().createNewPlan('Fresh Plan');

    const state = store.getState();
    expect(newPlanId).toBeTruthy();
    expect(state.plan.id).toBe(newPlanId);
    expect(state.plan.name).toBe('Fresh Plan');
    expect(state.plan.stamps).toHaveLength(0);
    expect(state.plan.elements).toHaveLength(1);
    expect(state.ui.activeTool).toBe('stamp');
    expect(state.ui.selection.selectedStampId).toBeNull();
    expect(state.history.past).toHaveLength(0);
    expect(state.history.future).toHaveLength(0);
  });

  it('loads a plan and resets selection and history', () => {
    store.getState().setPlanName('Before Load');
    const loadedPlan = {
      id: 'plan-loaded',
      name: 'Loaded Plan',
      backgroundImage: 'data:image/png;base64,abc',
      elements: [
        {
          id: 'element-loaded',
          name: 'Loaded Shrub',
          shapeId: 'plant07_round_shrub' as const,
          color: 'Pine' as const,
          scale: 1.4,
        },
      ],
      stamps: [
        {
          id: 'stamp-loaded',
          elementId: 'element-loaded',
          x: 210,
          y: 180,
          zIndex: 1,
        },
      ],
      viewport: {
        zoom: 1.3,
        panX: 12,
        panY: -8,
      },
    };

    store.getState().loadPlan(loadedPlan);

    const state = store.getState();
    expect(state.plan).toEqual(loadedPlan);
    expect(state.ui.selectedElementId).toBe('element-loaded');
    expect(state.ui.selection.selectedStampId).toBeNull();
    expect(state.ui.selection.resizeMode).toBe(false);
    expect(state.history.past).toHaveLength(0);
    expect(state.history.future).toHaveLength(0);
  });
});
