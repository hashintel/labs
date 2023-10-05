// Cause js modulo is just plain wrong
export const mod = (number: number, divisor: number) =>
  ((number % divisor) + divisor) % divisor;
