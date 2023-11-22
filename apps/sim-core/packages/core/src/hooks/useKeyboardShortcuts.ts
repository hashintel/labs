import { MutableRefObject, useEffect, useRef } from "react";

/**
 * Sometimes the particular key is difficult or messy to use in object notation
 * and so we have this enum to help. This is not supposed to be exhaustive, just
 * add a key when you need it.
 */
export enum HotKey {
  Period = ".",
}

export const getMetaCharacter = () =>
  navigator.platform.toUpperCase().indexOf("MAC") >= 0 ? "⌘" : "Ctrl";

type ShortcutMap = Record<string, VoidFunction | undefined>;

interface HandlerDescription {
  meta?: ShortcutMap;
  metaShift?: ShortcutMap;
  single?: ShortcutMap;
  alt?: ShortcutMap;
}

const listeningState: {
  listener: null | ((evt: KeyboardEvent) => void);
  handlers: MutableRefObject<HandlerDescription>[];
} = {
  listener: null,
  handlers: [],
};

export const useKeyboardShortcuts = (handlers: HandlerDescription) => {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!listeningState.listener) {
      listeningState.listener = (evt: KeyboardEvent) => {
        for (const handlersRef of listeningState.handlers) {
          let handlers: ShortcutMap | undefined;

          if (evt.ctrlKey || evt.metaKey) {
            handlers = evt.shiftKey
              ? handlersRef.current.metaShift
              : handlersRef.current.meta;
          } else if (evt.altKey) {
            handlers = handlersRef.current.alt;
          } else {
            handlers = handlersRef.current.single;
          }

          const handler = handlers?.[evt.key];

          if (handler) {
            evt.preventDefault();
            handler();
          }
        }
      };

      window.addEventListener("keydown", listeningState.listener);
    }

    listeningState.handlers.push(handlersRef);

    return () => {
      listeningState.handlers.splice(
        listeningState.handlers.indexOf(handlersRef),
        1,
      );

      if (!listeningState.handlers.length && listeningState.listener) {
        window.removeEventListener("keydown", listeningState.listener);
        listeningState.listener = null;
      }
    };
  }, []);
};
