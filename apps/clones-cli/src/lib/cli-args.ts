export function hasSubcommandArg(rawArgs: string[] | undefined): boolean {
  if (!rawArgs || rawArgs.length === 0) {
    return false;
  }

  return rawArgs.findIndex((arg) => !arg.startsWith('-')) !== -1;
}
