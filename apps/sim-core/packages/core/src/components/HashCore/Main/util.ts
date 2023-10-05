import { useEffect, useState } from "react";

export function useAddClassOnClick(className: string, classToAdd: string) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let currentSplitter: HTMLElement | null;
    let timeout: any;

    function mouseup() {
      if (currentSplitter) {
        const { classList } = currentSplitter;

        classList.add(classToAdd);
        timeout = setTimeout(() => {
          classList.remove(classToAdd);
        });

        currentSplitter = null;
      }
    }

    function mousedown(evt: MouseEvent) {
      const target = evt.target as HTMLElement;

      if (target.classList.contains(className)) {
        currentSplitter = target;
      }
    }

    container?.addEventListener("mousedown", mousedown);
    document.addEventListener("mouseup", mouseup);

    return () => {
      container
        ?.querySelectorAll(`.${className}.${classToAdd}`)
        ?.forEach((node) => node.classList.remove(classToAdd));

      container?.removeEventListener("mousedown", mousedown);
      document.removeEventListener("mouseup", mouseup);
      clearTimeout(timeout);
      currentSplitter = null;
    };
  }, [container, classToAdd, className]);

  return [setContainer];
}
