/**
 * From https://stackblitz.com/edit/rxjs-smxeuk?devtoolsheight=60
 */

/** MIT License (c) Ben Lesh <ben@benlesh.com>  */

import { Observable, ObservableInput, Subscription, from } from "rxjs";

export function exhaustMapWithTrailing<T, R>(
  fn: (value: T) => ObservableInput<R>,
) {
  return (source: Observable<T>) =>
    new Observable<R>((subscriber) => {
      const subscription = new Subscription();
      let lastValue: T;
      let hasLastValue = false;
      let innerSubscription: Subscription | null = null;
      let outerComplete = false;

      const doInnerSub = () => {
        // If we have actually recieved a value, try to map and subscribe to the result.
        if (hasLastValue) {
          let result: Observable<any>;
          try {
            result = from(fn(lastValue));
          } catch (err) {
            // There was a problem with the mapping, error out.
            subscriber.error(err);
            return;
          }
          // Clear the hasLastValue, so we don't reuse the old one twice.
          hasLastValue = false;
          // Subscribe to the inner observable.
          innerSubscription = result.subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => subscriber.error(err),
            complete: () => {
              // Null this out, it's used to flag whether or not we have an innerSubscription.
              // the inner subscription will automatically unsubscribe and remove itself right
              // after this complete call, so no worries there.
              innerSubscription = null;
              if (outerComplete && !hasLastValue) {
                // our outer is complete, and so is this, we can't get any more inners, so just complete.
                subscriber.complete();
              } else {
                // Otherwise, check to see if we have any more waiting.
                doInnerSub();
              }
            },
          });
          // Add the inner subscription, so when the consumer unsubscribes, this tears down.
          subscription.add(innerSubscription);
        }
      };

      // Subscribe to the source.
      subscription.add(
        source.subscribe({
          next: (value) => {
            hasLastValue = true;
            lastValue = value;
            if (!innerSubscription) {
              doInnerSub();
            }
          },
          error: (err) => subscriber.error(err),
          complete: () => {
            outerComplete = true;
            if (!innerSubscription) {
              subscriber.complete();
            }
          },
        }),
      );

      return subscription;
    });
}
