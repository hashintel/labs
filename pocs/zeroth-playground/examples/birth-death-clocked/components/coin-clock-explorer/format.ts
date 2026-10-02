/** A number for a readout, with a fixed count of decimals and a true minus sign. */
export function fixed(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits).replace("-", "−") : "∞";
}
