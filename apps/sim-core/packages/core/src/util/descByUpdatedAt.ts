export function descByUpdatedAt<T extends { updatedAt: string }>(
  { updatedAt: a }: T,
  { updatedAt: b }: T
): number {
  return a === b ? 0 : a > b ? -1 : 1;
}
