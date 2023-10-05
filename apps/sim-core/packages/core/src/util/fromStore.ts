import { Store } from "@reduxjs/toolkit";
import { InteropObservable, from } from "rxjs";

/**
 * Redux stores are already observable compatible, but TypeScript seems to
 * dislike it for whatever reason.
 *
 * @todo find out why
 */
export const fromStore = <T>(store: Store<T>) =>
  from((store as any) as InteropObservable<T>);
