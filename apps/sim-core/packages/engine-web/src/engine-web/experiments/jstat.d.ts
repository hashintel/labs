declare module "jstat" {
  // http://jstat.github.io/distributions.html#jStat.normal
  export module normal {
    export function sample(mean: number, std: number): number;
  }

  // http://jstat.github.io/distributions.html#jStat.lognormal
  export module lognormal {
    export function sample(mu: number, sigma: number): number;
  }

  // http://jstat.github.io/distributions.html#jStat.poisson
  export module poisson {
    export function sample(rate: number): number;
  }

  // http://jstat.github.io/distributions.html#jStat.beta
  export module beta {
    export function sample(alpha: number, beta: number): number;
  }

  // http://jstat.github.io/distributions.html#jStat.gamma
  export module gamma {
    export function sample(shape: number, scale: number): number;
  }
}
