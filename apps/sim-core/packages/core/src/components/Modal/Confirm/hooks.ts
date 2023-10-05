import { useEffect } from "react";

export const useModalConfirm = (onAnswer: (confirm: boolean) => void) => {
  useEffect(() => {
    function handler(evt: KeyboardEvent) {
      if (evt.key === "Enter") {
        evt.preventDefault();
        onAnswer(true);
      }
    }

    window.addEventListener("keydown", handler);

    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [onAnswer]);
};
