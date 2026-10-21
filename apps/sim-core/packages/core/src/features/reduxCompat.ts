/**
 * Minimal Redux-compatible utilities using only Immer.
 * Drop-in replacement for @reduxjs/toolkit functions used in this codebase.
 * This allows existing slice code to work with minimal changes.
 */
import { produce, current, freeze } from "immer";
import type { Draft } from "immer";
import { observable as rxjsSymbol } from "rxjs";

export { produce, current, freeze };
export type { Draft };

// Re-export reselect (used throughout selectors)
export { createSelector } from "reselect";

// ---------------------------------------------------------------------------
// Type compatibility
// ---------------------------------------------------------------------------

export type PayloadAction<P = void, T extends string = string> = {
  type: T;
  payload: P;
};

export type EntityId = string | number;

export type AnyAction = { type: string; [key: string]: any };

export type Selector<S, R> = (state: S) => R;

// ---------------------------------------------------------------------------
// createAction
// ---------------------------------------------------------------------------

export interface ActionCreator<P = void> {
  (payload: P): { type: string; payload: P };
  (): { type: string; payload: undefined };
  type: string;
  match: (action: AnyAction) => action is { type: string; payload: P };
  toString: () => string;
}

export function createAction<P = void>(type: string): ActionCreator<P> {
  const creator = ((...args: any[]) => ({ type, payload: args[0] })) as any;
  creator.type = type;
  creator.match = (action: AnyAction): boolean => action.type === type;
  creator.toString = () => type;
  return creator;
}

// ---------------------------------------------------------------------------
// createSlice
// ---------------------------------------------------------------------------

type SliceReducer<S> = (state: Draft<S>, action: any) => void | S;

interface ExtraReducersBuilder<S> {
  addCase: (
    actionCreator: { type: string } | string,
    reducer: (state: Draft<S>, action: any) => void | S,
  ) => ExtraReducersBuilder<S>;
}

interface SliceConfig<S, R extends Record<string, SliceReducer<S>>> {
  name: string;
  initialState: S;
  reducers: R;
  extraReducers?: (builder: ExtraReducersBuilder<S>) => void;
}

type SliceActionCreators = Record<
  string,
  ((...args: any[]) => AnyAction) & {
    type: string;
    match: (action: AnyAction) => boolean;
    toString: () => string;
  }
>;

interface Slice<S, _R extends Record<string, SliceReducer<S>>> {
  reducer: (state: S | undefined, action: AnyAction) => S;
  actions: SliceActionCreators;
}

export function createSlice<
  S,
  R extends Record<string, SliceReducer<S>> = Record<string, SliceReducer<S>>,
>(config: SliceConfig<S, R>): Slice<S, R> {
  const { name, initialState, reducers, extraReducers } = config;

  const actions: Record<string, ActionCreator<any>> = {};

  for (const key of Object.keys(reducers)) {
    const type = `${name}/${key}`;
    actions[key] = createAction(type);
  }

  const extraCases: Record<string, SliceReducer<S>> = {};
  if (extraReducers) {
    const builder: ExtraReducersBuilder<S> = {
      addCase(actionCreatorOrType, reducer) {
        const type =
          typeof actionCreatorOrType === "string"
            ? actionCreatorOrType
            : actionCreatorOrType.type;
        extraCases[type] = reducer;
        return builder;
      },
    };
    extraReducers(builder);
  }

  const reducer = (state: S = initialState, action: AnyAction): S => {
    const actionKey = action.type.startsWith(`${name}/`)
      ? action.type.slice(name.length + 1)
      : null;

    if (actionKey && reducers[actionKey]) {
      return produce(state, (draft) => {
        return reducers[actionKey](draft, action) as any;
      });
    }

    if (extraCases[action.type]) {
      return produce(state, (draft) => {
        return extraCases[action.type](draft, action) as any;
      });
    }

    return state;
  };

  return {
    reducer,
    actions: actions as SliceActionCreators,
  };
}

// ---------------------------------------------------------------------------
// createEntityAdapter
// ---------------------------------------------------------------------------

interface EntityState<T> {
  ids: EntityId[];
  entities: Record<EntityId, T | undefined>;
}

interface EntityAdapterConfig<T> {
  selectId?: (entity: T) => EntityId;
  sortComparer?: (a: T, b: T) => number;
}

interface EntitySelectors<T, S> {
  selectIds: (state: S) => EntityId[];
  selectEntities: (state: S) => Record<EntityId, T | undefined>;
  selectAll: (state: S) => T[];
  selectTotal: (state: S) => number;
  selectById: (state: S, id: EntityId) => T | undefined;
}

interface EntityAdapter<T> {
  getInitialState: <Extra extends Record<string, any>>(
    extra: Extra,
  ) => EntityState<T> & Extra;
  addOne: <S extends EntityState<T>>(state: S, entity: T) => S;
  addMany: <S extends EntityState<T>>(state: S, entities: T[]) => S;
  updateOne: <S extends EntityState<T>>(
    state: S,
    update: { id: EntityId; changes: Partial<T> },
  ) => S;
  upsertOne: <S extends EntityState<T>>(state: S, entity: T) => S;
  removeOne: <S extends EntityState<T>>(state: S, id: EntityId) => S;
  removeMany: <S extends EntityState<T>>(state: S, ids: EntityId[]) => S;
  getSelectors: {
    (): EntitySelectors<T, EntityState<T>>;
    <S>(selectState: (root: S) => EntityState<T>): EntitySelectors<T, S>;
  };
}

export function createEntityAdapter<T>(
  config: EntityAdapterConfig<T> = {},
): EntityAdapter<T> {
  const { selectId = (entity: any) => entity.id, sortComparer } = config;

  function insertSorted(state: EntityState<T>, id: EntityId) {
    if (state.ids.includes(id)) return;
    if (!sortComparer) {
      state.ids.push(id);
      return;
    }
    const entity = state.entities[id];
    if (!entity) return;
    const idx = state.ids.findIndex((existingId) => {
      const existing = state.entities[existingId];
      return existing ? sortComparer(entity, existing) < 0 : false;
    });
    if (idx === -1) {
      state.ids.push(id);
    } else {
      state.ids.splice(idx, 0, id);
    }
  }

  return {
    getInitialState<Extra extends Record<string, any>>(extra: Extra) {
      return { ids: [], entities: {}, ...extra } as EntityState<T> & Extra;
    },

    addOne(state: any, entity: T) {
      const id = selectId(entity);
      state.entities[id] = entity;
      insertSorted(state, id);
      return state;
    },

    addMany(state: any, entities: T[]) {
      for (const entity of entities) {
        const id = selectId(entity);
        state.entities[id] = entity;
      }
      for (const entity of entities) {
        insertSorted(state, selectId(entity));
      }
      return state;
    },

    updateOne(state: any, update: { id: EntityId; changes: Partial<T> }) {
      const existing = state.entities[update.id];
      if (!existing) return state;
      state.entities[update.id] = { ...existing, ...update.changes };
      return state;
    },

    upsertOne(state: any, entity: T) {
      const id = selectId(entity);
      const existing = state.entities[id];
      if (existing) {
        state.entities[id] = { ...existing, ...entity };
      } else {
        state.entities[id] = entity;
        insertSorted(state, id);
      }
      return state;
    },

    removeOne(state: any, id: EntityId) {
      delete state.entities[id];
      const idx = state.ids.indexOf(id);
      if (idx > -1) state.ids.splice(idx, 1);
      return state;
    },

    removeMany(state: any, ids: EntityId[]) {
      for (const id of ids) {
        delete state.entities[id];
        const idx = state.ids.indexOf(id);
        if (idx > -1) state.ids.splice(idx, 1);
      }
      return state;
    },

    getSelectors(selectState?: (root: any) => EntityState<T>) {
      if (!selectState) {
        return {
          selectIds: (state: EntityState<T>) => state.ids,
          selectEntities: (state: EntityState<T>) => state.entities,
          selectAll: (state: EntityState<T>) =>
            state.ids.map((id) => state.entities[id]).filter(Boolean) as T[],
          selectTotal: (state: EntityState<T>) => state.ids.length,
          selectById: (state: EntityState<T>, id: EntityId) =>
            state.entities[id],
        } as EntitySelectors<T, EntityState<T>>;
      }

      return {
        selectIds: (root: any) => selectState(root).ids,
        selectEntities: (root: any) => selectState(root).entities,
        selectAll: (root: any) => {
          const state = selectState(root);
          return state.ids
            .map((id) => state.entities[id])
            .filter(Boolean) as T[];
        },
        selectTotal: (root: any) => selectState(root).ids.length,
        selectById: (root: any, id: EntityId) => selectState(root).entities[id],
      } as EntitySelectors<T, any>;
    },
  };
}

// ---------------------------------------------------------------------------
// SimpleStore - minimal Redux-compatible store
// ---------------------------------------------------------------------------

export type Middleware<_DispatchExt = {}, S = any, _Dispatch = any> = (api: {
  getState: () => S;
  dispatch: (action: any) => any;
}) => (next: (action: any) => any) => (action: any) => any;

export interface Store<S> {
  getState: () => S;
  dispatch: (action: any) => any;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<S>(
  rootReducer: (state: S | undefined, action: AnyAction) => S,
  middleware: Middleware<S>[] = [],
): Store<S> {
  let state: S = rootReducer(undefined, { type: "@@INIT" });
  const listeners = new Set<() => void>();

  const getState = () => state;

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const rawDispatch: (action: AnyAction) => any = (action) => {
    state = rootReducer(state, action);
    listeners.forEach((fn) => fn());
    return action;
  };

  const storeApi = {
    getState,
    dispatch: (action: any) => dispatch(action),
  };

  const chain = middleware.map((mw) => mw(storeApi));
  const chainedDispatch = chain.reduceRight((next, mw) => mw(next), rawDispatch);

  function dispatch(action: any): any {
    if (typeof action === "function") {
      return action(dispatch, getState);
    }
    return chainedDispatch(action);
  }

  return {
    getState,
    dispatch,
    subscribe,
    [rxjsSymbol]() {
      return {
        subscribe(observer: { next: (v: any) => void; complete?: () => void }) {
          observer.next(getState());
          const unsub = subscribe(() => observer.next(getState()));
          return { unsubscribe: unsub };
        },
      };
    },
  };
}
