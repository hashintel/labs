import { Store } from "redux";
import { distinctUntilChanged, filter, map } from "rxjs/operators";

import { RootState } from "../types";
import { fromStore } from "../../util/fromStore";
import { selectLinkableProject, selectProjectLoaded } from "./selectors";

export const projectChangeObservable = (store: Store<RootState>) =>
  fromStore(store).pipe(
    map((state) =>
      selectProjectLoaded(state) ? selectLinkableProject(state) : null
    ),
    distinctUntilChanged(),
    filter(<T>(url: T | null): url is T => url !== null)
  );
