import { describe, expect, it } from 'vitest';

import {
  getPersistedPlanById,
  listSavedPlanSummaries,
  readPersistedPlans,
  setActivePersistedPlan,
  upsertPersistedPlan,
} from './planPersistence';
import { LOCAL_STORAGE_KEY, type Plan } from './state/types';

class MemoryStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key) ?? null : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const createPlanFixture = (id: string, name: string): Plan => ({
  id,
  name,
  backgroundImage: null,
  elements: [
    {
      id: `element-${id}`,
      name: 'Shrub',
      shapeId: 'plant07_round_shrub',
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

describe('plan persistence', () => {
  it('returns empty state when storage is missing or corrupted', () => {
    const storage = new MemoryStorage();

    expect(readPersistedPlans(storage)).toMatchObject({
      activePlanId: null,
      plans: [],
    });

    storage.setItem(LOCAL_STORAGE_KEY, 'not-json');
    expect(readPersistedPlans(storage)).toMatchObject({
      activePlanId: null,
      plans: [],
    });
  });

  it('saves and loads plans by id', () => {
    const storage = new MemoryStorage();
    const saved = upsertPersistedPlan(createPlanFixture('plan-1', 'Front Yard'), storage);
    expect(saved).not.toBeNull();

    const loaded = getPersistedPlanById('plan-1', storage);
    expect(loaded?.id).toBe('plan-1');
    expect(loaded?.name).toBe('Front Yard');
  });

  it('updates existing plan snapshots by id and tracks active plan', () => {
    const storage = new MemoryStorage();
    upsertPersistedPlan(createPlanFixture('plan-1', 'Front Yard'), storage);
    upsertPersistedPlan(createPlanFixture('plan-2', 'Back Yard'), storage);
    upsertPersistedPlan(createPlanFixture('plan-1', 'Front Yard Revised'), storage);

    const persisted = readPersistedPlans(storage);
    expect(persisted.plans).toHaveLength(2);
    expect(persisted.activePlanId).toBe('plan-1');
    expect(persisted.plans.find((entry) => entry.plan.id === 'plan-1')?.plan.name).toBe(
      'Front Yard Revised',
    );
  });

  it('sets active plan and returns plan summaries', () => {
    const storage = new MemoryStorage();
    upsertPersistedPlan(createPlanFixture('plan-1', 'Front Yard'), storage);
    upsertPersistedPlan(createPlanFixture('plan-2', 'Back Yard'), storage);

    const updated = setActivePersistedPlan('plan-1', storage);
    expect(updated?.activePlanId).toBe('plan-1');

    const summaries = listSavedPlanSummaries(readPersistedPlans(storage));
    expect(summaries.map((summary) => summary.id).sort()).toEqual(['plan-1', 'plan-2']);
    expect(summaries.map((summary) => summary.name).sort()).toEqual(['Back Yard', 'Front Yard']);
  });
});
