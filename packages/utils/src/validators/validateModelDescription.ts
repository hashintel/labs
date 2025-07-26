/**
 * For use in validating model description – this must be as tight or tighter than
 * the GitLab API, otherwise it'll fail when actually creating.
 */
export const validateModelDescription = (desc: string): boolean =>
  desc.length <= 250;

validateModelDescription.allowedCharactersMessage =
  "Your model description must be 250 characters or less.";
