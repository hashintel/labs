import type { AnyAction } from "../reduxCompat";
import { Subject } from "rxjs";

export const simulatorStoreActionObservable = new Subject<AnyAction>();
