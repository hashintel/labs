/**
 * The exponential delay behind both ways of compiling a rate: the survival a
 * clock reads, the threshold a coin tests, and the identities between them.
 */

/** The probability that a delay of rate `lambda` has not expired by time `t`: e^(-λt). */
export function survival(lambda: number, t: number): number {
  return Math.exp(-lambda * t);
}

/** The coin's threshold for one step of `dt`, computed at compile time: θ = e^(-λ·dt). */
export function threshold(lambda: number, dt: number): number {
  return survival(lambda, dt);
}

/** The chance a coin fires in one step of `dt`: p = 1 - e^(-λ·dt). */
export function fireProbability(lambda: number, dt: number): number {
  return -Math.expm1(-lambda * dt);
}

/** The clock delay one uniform draw `u` in (0, 1] stands for: τ = -ln(u)/λ, so that u = S(τ). */
export function delayFromDraw(lambda: number, u: number): number {
  return -Math.log(u) / lambda;
}

/** Whether a draw `u` reaches the threshold `theta`: the coin's test, u ≥ θ. */
export function firesAt(u: number, theta: number): boolean {
  return u >= theta;
}

/** The class modifier for a draw against `theta`, or undefined when there is no draw. */
export function fireModifier(u: number | undefined, theta: number): "fires" | "waits" | undefined {
  if (u === undefined) {
    return undefined;
  }
  return firesAt(u, theta) ? "fires" : "waits";
}

/** The rate a coin achieves when it fires at most once per step: p/dt, always below λ. */
export function effectiveRate(lambda: number, dt: number): number {
  return fireProbability(lambda, dt) / dt;
}
