import { AnyAction } from "redux";
import { Subject } from "rxjs";

export const storeActionObservable = new Subject<AnyAction>();
