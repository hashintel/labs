import { Store } from "@reduxjs/toolkit";
import { Observable, combineLatest, fromEvent, merge } from "rxjs";
import {
  distinctUntilChanged,
  filter,
  map,
  mapTo,
  startWith,
} from "rxjs/operators";

import { RootState } from "../types";
import { Scope, selectScope } from "../scopes";
import { fromStore } from "../../util/fromStore";
import { save } from "../thunks";
import { selectFileActions } from "../files/selectors";

const debounceTimeWithMaximum =
  <T>(
    debounceMs: number,
    maximumMs: number,
    skipTimeout: (next: T) => boolean,
  ) =>
  (source: Observable<T>) =>
    new Observable<T>((observer) => {
      let currentValue: T;
      let debounceTimeout: number | null = null;
      let raceTimeout: number | null = null;

      const resolve = () => {
        observer.next(currentValue);
        if (debounceTimeout) {
          window.clearTimeout(debounceTimeout);
        }

        if (raceTimeout) {
          window.clearTimeout(raceTimeout);
        }

        debounceTimeout = null;
        raceTimeout = null;
      };

      return source.subscribe({
        next: (value) => {
          currentValue = value;

          if (debounceTimeout) {
            window.clearTimeout(debounceTimeout);
          }

          debounceTimeout = window.setTimeout(resolve, debounceMs);

          if (!raceTimeout) {
            raceTimeout = window.setTimeout(resolve, maximumMs);
          }

          if (skipTimeout(value)) {
            resolve();
          }
        },
        error: (err) => observer.error(err),
        complete: () => observer.complete(),
      });
    });

export const autoSaveSubscribe = (store: Store<RootState>) => {
  const focus = merge(
    fromEvent(window, "focus").pipe(mapTo(true)),
    fromEvent(window, "blur").pipe(mapTo(false)),
  ).pipe(startWith(document.hasFocus()));

  const actions = fromStore(store).pipe(
    filter((state) => selectScope[Scope.save](state)),
    map(selectFileActions),
    distinctUntilChanged(),
    filter((actions) => actions.length > 0),
    debounceTimeWithMaximum(5_000, 10_000, (actions) =>
      actions.some(
        (action) =>
          action.type !== "update" || action.repoPath === "dependencies.json",
      ),
    ),
  );

  const actionsWhenFocused = combineLatest([focus, actions]).pipe(
    filter(([focused]) => focused),
    map(([_, actions]) => actions),
  );

  actionsWhenFocused.subscribe(() => {
    store.dispatch(save()).catch((err) => {
      console.error("Failed to save", err);
    });
  });
};
