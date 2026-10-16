/**
 * Legacy cloud “promote to live” hook. No-op in the local-first build.
 */
export const promoteToLive = async (
  _args: { stamp: string },
  _signal: AbortSignal,
): Promise<void> => {
  console.warn("promoteToLive is not available in the local-first build");
};
