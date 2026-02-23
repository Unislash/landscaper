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
        shapeId: 'shrub',
      }),
    ]);
    expect(state.ui.selection.selectedStampId).toBeNull();
    expect(state.ui.selectedElementId).toBe(SEEDED_ELEMENT_ID);
    expect(state.ui.activeTool).toBe('select');
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
      color: 'Brown',
      scale: 1.25,
    });

    const state = store.getState();
    expect(state.plan.elements[0]?.color).toBe('Brown');
    expect(state.plan.elements[0]?.scale).toBe(1.25);
    expect(state.history.past).toHaveLength(1);
    expect(state.history.past[0]?.snapshot.plan.elements[0]?.color).toBe('Green');
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
      shapeId: 'square',
      color: 'Brown',
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
      shapeId: 'square',
      color: 'Brown',
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
});
