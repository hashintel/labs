/**
 * Taken from @juggle/resize-observer
 *
 * @todo Remove this when we can use `import type` once https://github.com/hashintel/internal/issues/938
 *        has been completed
 */
declare enum ResizeObserverBoxOptions {
  BORDER_BOX = "border-box",
  CONTENT_BOX = "content-box",
  DEVICE_PIXEL_CONTENT_BOX = "device-pixel-content-box",
}
interface ResizeObserverOptions {
  box?:
    | "content-box"
    | "border-box"
    | "device-pixel-content-box"
    | ResizeObserverBoxOptions;
}
interface ResizeObserverSize {
  readonly inlineSize: number;
  readonly blockSize: number;
}
declare class ResizeObserverEntry {
  target: Element;
  contentRect: DOMRectReadOnly;
  borderBoxSize: ResizeObserverSize[];
  contentBoxSize: ResizeObserverSize[];
  devicePixelContentBoxSize: ResizeObserverSize[];
  constructor(target: Element);
}
declare type ResizeObserverCallback = (
  entries: ResizeObserverEntry[],
  observer: ResizeObserver
) => void;
declare class ResizeObserver {
  constructor(callback: ResizeObserverCallback);
  observe(target: Element, options?: ResizeObserverOptions): void;
  unobserve(target: Element): void;
  disconnect(): void;
  static toString(): string;
}

export type { ResizeObserverCallback, ResizeObserver };
declare global {
  interface Window {
    ResizeObserver: typeof ResizeObserver;
  }
}
