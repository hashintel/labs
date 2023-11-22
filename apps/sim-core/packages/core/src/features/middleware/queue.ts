/**
 * Based off of redux-async-queue
 *
 * @see https://github.com/zackargyle/redux-async-queue
 */
import { Middleware } from "@reduxjs/toolkit";

import { AppDispatch, RootState } from "../types";

const QUEUE_ACTION_TAG = "__QUEUED_ACTION_TYPE";

type QueuedCallback = (
  next: VoidFunction,
  getState: () => RootState,
  dispatch: AppDispatch,
) => void;

export interface QueueableAction {
  [QUEUE_ACTION_TAG]: string;
  handler: QueuedCallback;
}

export type QueueDispatch = (queueableAction: QueueableAction) => Promise<void>;

const queueAction = (queue: string, handler: QueuedCallback) => ({
  [QUEUE_ACTION_TAG]: queue,
  handler,
});

const usedNames: string[] = [];

export const createActionQueue = (name: string) => {
  if (usedNames.includes(name)) {
    throw new Error(`Queue with ${name} exists`);
  }

  usedNames.push(name);

  const fullName = `QUEUE_${name}`;

  return {
    queue: (handler: QueuedCallback) => queueAction(fullName, handler),
  };
};

const isQueueable = (action: any): action is QueueableAction =>
  QUEUE_ACTION_TAG in action;

/**
 * Redux behaviour changed by middleware, so overloads here
 */
declare module "redux" {
  //@ts-expect-error fix this as part of dispatch type problems
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export type Dispatch<A extends Action = AnyAction> = (
    action: QueueableAction,
  ) => Promise<void>;
}

export const queueMiddleware: Middleware<QueueDispatch, RootState> = (
  store,
) => {
  const queues: Record<string, QueuedCallback[] | undefined> = {};

  const dequeue = (key: string) => {
    const queue = queues[key];

    if (queue) {
      const action = queue[0];

      if (action) {
        action(
          () => {
            queue.shift();
            dequeue(key);
          },
          store.getState,
          //@ts-expect-error redux type problems
          store.dispatch,
        );
      }
    }
  };

  return (next) => (action) => {
    if (isQueueable(action)) {
      return new Promise<void>((resolve) => {
        const key = action[QUEUE_ACTION_TAG];
        const queue = queues[key] ?? [];
        queues[key] = queue;

        queue.push((next, ...args) => {
          action.handler(
            () => {
              resolve();
              next();
            },
            ...args,
          );
        });

        if (queue.length === 1) {
          dequeue(key);
        }
      });
    } else {
      return next(action);
    }
  };
};
