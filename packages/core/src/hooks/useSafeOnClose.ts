export const useSafeOnClose = (
  isSafe: boolean,
  canClose: boolean,
  onClose: VoidFunction,
) => {
  return () => {
    if (canClose) {
      const shouldClose =
        isSafe ||
        confirm("You have unsaved changes. Are you sure you want to cancel?");

      if (shouldClose) {
        onClose();
      }
    }
  };
};
