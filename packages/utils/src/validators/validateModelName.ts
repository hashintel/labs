/**
 * For use in validating model names – this must be as tight or tighter than
 * the GitLab API, otherwise it'll fail when actually creating.
 */
export const validateModelName = (name: string): boolean =>
  !!name.match(/^[A-Za-z0-9_\-\s]+$/);

validateModelName.allowedCharactersMessage =
  "Your model name may only contain alphanumeric characters, '_', and '-', and must not be empty.";
