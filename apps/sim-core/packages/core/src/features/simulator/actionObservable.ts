import { AnyAction } from "redux";
import { Subject } from "rxjs";

export const simulatorStoreActionObservable = new Subject<AnyAction>();
