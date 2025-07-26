// jStat doesn't provide typescript typings
// We provide manual typings in jstat.d.ts
import * as stat from "jstat";

type RawDistributions = {
  // http://jstat.github.io/distributions.html#jStat.normal
  normal: {
    mean: number;
    std: number;
  };

  // http://jstat.github.io/distributions.html#jStat.lognormal
  "log-normal": {
    mu: number;
    sigma: number;
  };

  // http://jstat.github.io/distributions.html#jStat.poisson
  poisson: {
    rate: number;
  };

  // http://jstat.github.io/distributions.html#jStat.beta
  beta: {
    alpha: number;
    beta: number;
  };

  // http://jstat.github.io/distributions.html#jStat.gamma
  gamma: {
    shape: number;
    scale: number;
  };
};

type DistributionTypes = {
  [Type in keyof RawDistributions]: RawDistributions[Type] & {
    distribution: Type;
  };
};

export type MonteDistributions<Type = keyof DistributionTypes> = Extract<
  DistributionTypes[keyof DistributionTypes],
  { distribution: Type }
>;

export const sampleDistribution = (def: MonteDistributions): number => {
  switch (def.distribution) {
    case "normal":
      return stat.normal.sample(def.mean ?? 1, def.std ?? 1);

    case "log-normal":
      return stat.lognormal.sample(def.mu ?? 1, def.sigma ?? 1);

    case "poisson":
      return stat.poisson.sample(def.rate);

    case "beta":
      return stat.beta.sample(def.alpha ?? 1, def.beta ?? 1);

    case "gamma":
      return stat.gamma.sample(def.shape ?? 1, def.scale ?? 1);

    default:
      return stat.normal.sample(1, 1);
  }
};
