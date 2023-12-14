import { RefObject, useLayoutEffect } from "react";

import { IS_DEV } from "../util/api";

const syncedNodes = new Set<Element>();
const totalAnimations: (readonly [HTMLElement | SVGElement, Animation])[] = [];

const MAX_RETRY = 5;

/**
 * This will sync animation progress for elements added to the page after other
 * instances have begun.
 *
 * @warning This is not supported in all browsers we support
 */
export let useSyncAnimations = <T extends HTMLElement | SVGElement>(
  ref: RefObject<T>,
  className: string,
) => {
  useLayoutEffect(() => {
    const node = ref.current;

    if (node) {
      const attempt = (count: number, signal: AbortSignal) => {
        if (signal?.aborted) {
          return;
        }

        const nodeAnimations = node.getAnimations();

        if (nodeAnimations.length < 1) {
          if (
            /**
             * If offsetParent is null, the element is hidden. In which case, we
             * only want to attempt again once the animation has begun (i.e, it
             * is visible again).
             *
             * However, svg's do not have offsetParent, so we have to check the
             * svg's parent node's offsetParent. This does mean if the svg
             * itself is hidden, this will not detect it, but that's not a
             * use case we need to support right now.
             */
            (node.parentNode as HTMLElement | undefined)?.offsetParent === null
          ) {
            const handler = () => {
              node.removeEventListener("animationstart", handler);
              attempt(count + 1, signal);
            };

            signal.addEventListener("abort", () => {
              node.removeEventListener("animationstart", handler);
            });

            node.addEventListener("animationstart", handler);
          } else if (count < MAX_RETRY) {
            console.warn(
              `useSyncAnimations: Attempt #${count + 1} failed, retrying`,
            );
            const request = requestAnimationFrame(() => {
              attempt(count + 1, signal);
            });

            signal.addEventListener("abort", () => {
              cancelAnimationFrame(request);
            });
          } else {
            console.error(
              "useSyncAnimations: hit max retry on animation syncing, giving up",
            );
          }
          return;
        }

        totalAnimations.push([node, nodeAnimations[0]]);

        const spinners = Array.from(
          document.querySelectorAll<HTMLElement | SVGElement>(className),
        );
        const controlSpinner = spinners.find(
          (spinner) => spinner !== node && syncedNodes.has(spinner),
        );

        if (controlSpinner) {
          const copyAnimations = [...totalAnimations];

          for (const [, animation] of copyAnimations) {
            animation.pause();
          }

          const nodeAnimation = copyAnimations.find(
            ([spinner]) => spinner === node,
          )![1];
          const controlAnimation = copyAnimations.find(
            ([spinner]) => spinner === controlSpinner,
          )![1];

          /**
           * This ensures the icon is rotated to roughly the correct position from
           * first render. However, it can be slightly off because CSS animations
           * can run simultaneously to JavaScript and so we need to pause all
           * animations and then wait a frame whilst they're syncing
           */
          nodeAnimation.currentTime = controlAnimation.currentTime;

          requestAnimationFrame(function second() {
            for (const [spinner, animation] of copyAnimations) {
              if (spinner !== controlSpinner) {
                animation.currentTime = controlAnimation.currentTime;
              }
            }

            requestAnimationFrame(function third() {
              syncedNodes.add(node);

              for (const [, animation] of copyAnimations) {
                animation.play();
              }

              if (IS_DEV) {
                requestAnimationFrame(function fourth() {
                  const set = new Set(
                    totalAnimations.map(
                      (animation) => animation[1].currentTime,
                    ),
                  );
                  if (set.size > 1) {
                    console.warn("Syncing animations failed", Array.from(set));
                  }
                });
              }
            });
          });
        } else {
          syncedNodes.add(node);
        }
      };

      const controller = new AbortController();
      attempt(0, controller.signal);

      return () => {
        controller.abort();
        syncedNodes.delete(node);
        totalAnimations.splice(
          totalAnimations.findIndex((anim) => anim[0] === node),
          1,
        );
      };
    }
  }, [className, ref]);
};

if (
  !Object.prototype.hasOwnProperty.call(Element, "getAnimations") ||
  typeof Animation === "undefined" ||
  !Object.prototype.hasOwnProperty.call(Animation, "play") ||
  !Object.prototype.hasOwnProperty.call(Animation, "currentTime") ||
  !Object.prototype.hasOwnProperty.call(Animation, "pause")
) {
  console.warn(
    "useSyncAnimations: unsupported browser – disabling animation syncing",
  );

  useSyncAnimations = () => {};
}
