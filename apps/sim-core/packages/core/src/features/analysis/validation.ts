const validateTitleRule = (title: string): boolean =>
  title.length > 0 && !!title.match(/^[A-Za-z0-9_-]+$/);

const validateTitleRuleAllowedCharactersMessage =
  "Your metric title may only contain alphanumeric characters, '_', and '-', and must not be empty.";

export const validateTitle = (title: string) =>
  validateTitleRule(title) || validateTitleRuleAllowedCharactersMessage;
