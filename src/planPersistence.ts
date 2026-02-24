import { LOCAL_STORAGE_KEY, type Plan, type PlanElement, type Stamp } from './state/types';

export const PERSISTENCE_VERSION = 1 as const;

export interface SavedPlanRecord {
  plan: Plan;
  savedAt: string;
}

export interface PersistedPlans {
  version: typeof PERSISTENCE_VERSION;
  activePlanId: string | null;
  plans: SavedPlanRecord[];
}

export interface SavedPlanSummary {
  id: string;
  name: string;
  savedAt: string;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const EMPTY_PERSISTED_PLANS: PersistedPlans = {
  version: PERSISTENCE_VERSION,
  activePlanId: null,
  plans: [],
};

const cloneElements = (elements: PlanElement[]): PlanElement[] =>
  elements.map((element) => ({ ...element }));

const cloneStamps = (stamps: Stamp[]): Stamp[] => stamps.map((stamp) => ({ ...stamp }));

const clonePlan = (plan: Plan): Plan => ({
  ...plan,
  elements: cloneElements(plan.elements),
  stamps: cloneStamps(plan.stamps),
  backgroundImageSize: plan.backgroundImageSize ?? null,
  backgroundTransform: plan.backgroundTransform ?? null,
  viewport: { ...plan.viewport },
});

const clonePersistedPlans = (persistedPlans: PersistedPlans): PersistedPlans => ({
  version: persistedPlans.version,
  activePlanId: persistedPlans.activePlanId,
  plans: persistedPlans.plans.map((entry) => ({
    plan: clonePlan(entry.plan),
    savedAt: entry.savedAt,
  })),
});

const getStorage = (storage?: StorageLike): StorageLike | null => {
  if (storage) {
    return storage;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage;
};

const isNonNullObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPlanShape = (value: unknown): value is Plan => {
  if (!isNonNullObject(value)) {
    return false;
  }

  const hasBackgroundSize =
    value.backgroundImageSize === undefined ||
    value.backgroundImageSize === null ||
    (isNonNullObject(value.backgroundImageSize) &&
      typeof value.backgroundImageSize.width === 'number' &&
      typeof value.backgroundImageSize.height === 'number');

  const hasBackgroundTransform =
    value.backgroundTransform === undefined ||
    value.backgroundTransform === null ||
    (isNonNullObject(value.backgroundTransform) &&
      typeof value.backgroundTransform.x === 'number' &&
      typeof value.backgroundTransform.y === 'number' &&
      typeof value.backgroundTransform.scale === 'number');

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (typeof value.backgroundImage === 'string' || value.backgroundImage === null) &&
    hasBackgroundSize &&
    hasBackgroundTransform &&
    Array.isArray(value.elements) &&
    Array.isArray(value.stamps) &&
    isNonNullObject(value.viewport) &&
    typeof value.viewport.zoom === 'number' &&
    typeof value.viewport.panX === 'number' &&
    typeof value.viewport.panY === 'number'
  );
};

const normalizePersistedPlans = (value: unknown): PersistedPlans => {
  if (!isNonNullObject(value) || value.version !== PERSISTENCE_VERSION || !Array.isArray(value.plans)) {
    return clonePersistedPlans(EMPTY_PERSISTED_PLANS);
  }

  const plans = value.plans
    .filter((entry): entry is Record<string, unknown> => isNonNullObject(entry))
    .map((entry) => {
      const maybePlan = entry.plan;
      if (!isPlanShape(maybePlan)) {
        return null;
      }

      return {
        plan: clonePlan(maybePlan),
        savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : new Date(0).toISOString(),
      };
    })
    .filter((entry): entry is SavedPlanRecord => entry !== null);

  const maybeActivePlanId = typeof value.activePlanId === 'string' ? value.activePlanId : null;
  const activePlanId = plans.some((entry) => entry.plan.id === maybeActivePlanId)
    ? maybeActivePlanId
    : (plans[0]?.plan.id ?? null);

  return {
    version: PERSISTENCE_VERSION,
    activePlanId,
    plans,
  };
};

export const readPersistedPlans = (storage?: StorageLike): PersistedPlans => {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return clonePersistedPlans(EMPTY_PERSISTED_PLANS);
  }

  const rawValue = resolvedStorage.getItem(LOCAL_STORAGE_KEY);
  if (!rawValue) {
    return clonePersistedPlans(EMPTY_PERSISTED_PLANS);
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown;
    return normalizePersistedPlans(parsedValue);
  } catch {
    return clonePersistedPlans(EMPTY_PERSISTED_PLANS);
  }
};

const writePersistedPlans = (persistedPlans: PersistedPlans, storage?: StorageLike): PersistedPlans | null => {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return null;
  }

  try {
    resolvedStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(persistedPlans));
    return clonePersistedPlans(persistedPlans);
  } catch {
    return null;
  }
};

export const listSavedPlanSummaries = (persistedPlans: PersistedPlans): SavedPlanSummary[] =>
  [...persistedPlans.plans]
    .sort((firstEntry, secondEntry) => secondEntry.savedAt.localeCompare(firstEntry.savedAt))
    .map((entry) => ({
      id: entry.plan.id,
      name: entry.plan.name,
      savedAt: entry.savedAt,
    }));

export const upsertPersistedPlan = (plan: Plan, storage?: StorageLike): PersistedPlans | null => {
  const persistedPlans = readPersistedPlans(storage);
  const timestamp = new Date().toISOString();
  const existingEntryIndex = persistedPlans.plans.findIndex((entry) => entry.plan.id === plan.id);

  const nextEntry: SavedPlanRecord = {
    plan: clonePlan(plan),
    savedAt: timestamp,
  };

  const nextPlans =
    existingEntryIndex >= 0
      ? persistedPlans.plans.map((entry, index) => (index === existingEntryIndex ? nextEntry : entry))
      : [...persistedPlans.plans, nextEntry];

  return writePersistedPlans(
    {
      ...persistedPlans,
      activePlanId: plan.id,
      plans: nextPlans,
    },
    storage,
  );
};

export const getPersistedPlanById = (planId: string, storage?: StorageLike): Plan | null => {
  const persistedPlans = readPersistedPlans(storage);
  const matchingEntry = persistedPlans.plans.find((entry) => entry.plan.id === planId);

  return matchingEntry ? clonePlan(matchingEntry.plan) : null;
};

export const setActivePersistedPlan = (planId: string, storage?: StorageLike): PersistedPlans | null => {
  const persistedPlans = readPersistedPlans(storage);
  if (!persistedPlans.plans.some((entry) => entry.plan.id === planId)) {
    return null;
  }

  return writePersistedPlans(
    {
      ...persistedPlans,
      activePlanId: planId,
    },
    storage,
  );
};
