import type { HcFile } from "./types";
import { fileSorter } from "./utils";

type EntityId = string;

interface EntityState<T> {
  ids: EntityId[];
  entities: Record<EntityId, T | undefined>;
}

function insertSorted(state: EntityState<HcFile>, id: EntityId) {
  if (state.ids.includes(id)) return;
  const entity = state.entities[id];
  if (!entity) return;
  const idx = state.ids.findIndex(
    (existingId) => fileSorter(entity, state.entities[existingId]!) < 0,
  );
  if (idx === -1) {
    state.ids.push(id);
  } else {
    state.ids.splice(idx, 0, id);
  }
}

export function getInitialState<S extends EntityState<HcFile>>(
  extra: Omit<S, "ids" | "entities">,
): S {
  return { ids: [], entities: {}, ...extra } as unknown as S;
}

export function addOne(state: EntityState<HcFile>, entity: HcFile): void {
  state.entities[entity.id] = entity;
  insertSorted(state, entity.id);
}

export function addMany(state: EntityState<HcFile>, entities: HcFile[]): void {
  for (const entity of entities) {
    state.entities[entity.id] = entity;
  }
  for (const entity of entities) {
    insertSorted(state, entity.id);
  }
}

export function updateOne(
  state: EntityState<HcFile>,
  update: { id: EntityId; changes: Partial<HcFile> },
): void {
  const existing = state.entities[update.id];
  if (!existing) return;
  Object.assign(existing, update.changes);
}

export function updateMany(
  state: EntityState<HcFile>,
  updates: Array<{ id: EntityId; changes: Partial<HcFile> }>,
): void {
  for (const update of updates) {
    updateOne(state, update);
  }
}

export function upsertOne(state: EntityState<HcFile>, entity: HcFile): void {
  const existing = state.entities[entity.id];
  if (existing) {
    Object.assign(existing, entity);
  } else {
    state.entities[entity.id] = entity;
    insertSorted(state, entity.id);
  }
}

export function upsertMany(
  state: EntityState<HcFile>,
  entities: HcFile[],
): void {
  for (const entity of entities) {
    upsertOne(state, entity);
  }
}

export function removeOne(state: EntityState<HcFile>, id: EntityId): void {
  delete state.entities[id];
  const idx = state.ids.indexOf(id);
  if (idx > -1) state.ids.splice(idx, 1);
}

export function removeMany(
  state: EntityState<HcFile>,
  ids: EntityId[],
): void {
  for (const id of ids) {
    removeOne(state, id);
  }
}

interface Selectors<S> {
  selectIds: (state: S) => EntityId[];
  selectEntities: (state: S) => Record<EntityId, HcFile | undefined>;
  selectAll: (state: S) => HcFile[];
  selectTotal: (state: S) => number;
  selectById: (state: S, id: EntityId) => HcFile | undefined;
}

export function getSelectors(): Selectors<EntityState<HcFile>>;
export function getSelectors<S>(
  selectState: (root: S) => EntityState<HcFile>,
): Selectors<S>;
export function getSelectors<S>(
  selectState?: (root: S) => EntityState<HcFile>,
): Selectors<any> {
  if (!selectState) {
    return {
      selectIds: (state: EntityState<HcFile>) => state.ids,
      selectEntities: (state: EntityState<HcFile>) => state.entities,
      selectAll: (state: EntityState<HcFile>) =>
        state.ids
          .map((id) => state.entities[id])
          .filter(Boolean) as HcFile[],
      selectTotal: (state: EntityState<HcFile>) => state.ids.length,
      selectById: (state: EntityState<HcFile>, id: EntityId) =>
        state.entities[id],
    };
  }

  return {
    selectIds: (root: S) => selectState(root).ids,
    selectEntities: (root: S) => selectState(root).entities,
    selectAll: (root: S) => {
      const state = selectState(root);
      return state.ids
        .map((id) => state.entities[id])
        .filter(Boolean) as HcFile[];
    },
    selectTotal: (root: S) => selectState(root).ids.length,
    selectById: (root: S, id: EntityId) => selectState(root).entities[id],
  };
}
