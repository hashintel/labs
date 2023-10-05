/**
 * For use in validating model paths – this must be as tight or tighter than
 * the GitLab API, otherwise it'll fail when actually creating.
 */
export const validateModelPath = (path: string) =>
  !!path.match(/^[a-z0-9_\-]+$/);

validateModelPath.allowedCharactersMessage =
  "Your model path may only contain lowercase alphanumeric characters, '_' and '-', and must not be empty.";
