/* eslint-disable */
declare namespace hstd {
  /**
   * Return a valid uuid-v4 address for defining a new agent
   */
  function generateAgentID(): string;
  /**
   * Return the distance between two agents. Distance functions available are "manhattan", "euclidean", "euclidean_sq", "chebyshev". If no function is provided, "euclidean" is used by default
   */
  function distanceBetween(
    agentA: Agent,
    agentB: Agent,
    distanceFunction?: "manhattan" | "euclidean" | "euclidean_sq" | "chebyshev",
  ): number;
  /**
   * Return the unit vector of vec
   */
  function normalizeVector(vec: number[]): number[];
  /**
   * Return a position array of integer values randomly chosen within the topology bounds. Topology is the context.globals().topology object. Pass true to z_plane if you do want a non-zero z value
   */
  function randomPosition(topology: Topology, z_plane?: boolean);
  /**
   * Return an array of Agents in the neighbors array that share agentA's position
   */
  function neighborsOnPosition(agentA: Agent, neighbors: Agent[]): Agent[];
  /**
   * Return all neighbors within a specified radius of an agent. Default [min, max] is [0, 1] in 2D space. Pass true to z_axis for 3D calculations
   */
  function neighborsInRadius(
    agentA: Agent,
    neighbors: Agent[],
    max_radius?: number,
    min_radius?: number,
    z_axis?: boolean,
  );
  /**
   * Return all neighbors in front of the plane of the agent. The agent must have a direction property. Pass true to colinear to only return neighbors that lie on the direction vector
   */
  function neighborsInFront(
    agentA: Agent,
    neighbors: Agent[],
    colinear?: boolean,
  );
  /**
   * Return all neighbors behind the plane of the agent. The agent must have a direction property. Pass true to colinear to only return neighbors that lie on the direction vector
   */
  function neighborsBehind(
    agentA: Agent,
    neighbors: Agent[],
    colinear?: boolean,
  );

  /**
   * Returns a random number betweeon 0 and 1
   */
  function random();

  /**
   * Sets a seed for rng.random() and the jStat library
   */
  function setSeed(s: string);
}

declare namespace hstd.init {
  /**
   * Returns an array of agents at random positions within the bounds defined in topology
   *
   * @param count number of agents generated here
   * @param topology object defining boundaries. Can be reused from context.globals()
   * @param template definition of the agents. May be an object or function which returns an object
   */
  function scatter(
    count: number,
    topology: Topology,
    template: Agent | AgentFunction,
  ): Agent[];

  /**
   * Returns an array of agents generated from the template
   *
   * @param count number of agents generated
   * @param template definition of the agents. May be an object or function which returns an object
   */
  function stack(count: number, template: Agent | AgentFunction): Agent[];

  /**
   * Returns an array of agents occupying every integer location within the bounds defined in topology
   *
   * @param topology object defining boundaries. Can be reused from context.globals()
   * @param template definition of the agents. May be an object or function which returns an object
   */
  function grid(topology: Topology, template: Agent | AgentFunction): Agent[];

  /**
   * Returns an array of agents based on a specified layout and set of templates
   *
   * @param layout 2D array representing the locations of different agents. Often contained in a dataset
   * @param templates object which keys the agents contained in the layout to their definitions
   * @param offset optional offset to use when defining agents' positions
   */
  function createLayout(
    layout: string[][],
    templates: { [key: string]: Agent },
    offset: number[],
  ): Agent[];
}

declare namespace hstd.stats {
  // --------Vector functions--------

  /**
   * Returns the sum of the array
   */
  function sum(array: number[]): number;
  /**
   * Returns the sum squared of the array
   */
  function sumsqrd(array: number[]): number;
  /**
   * Returns the sum of squared errors of prediction of the array
   */
  function sumsqerr(array: number[]): number;
  /**
   * Returns the sum of the array in row-based order
   */
  function sumrow(arrayOfArrays: number[][]): number;
  /**
   * Returns the product of the array
   */
  function product(array: number[]): number;
  /**
   * Returns the minimum value of the array
   */
  function min(array: number[]): number;
  /**
   * Returns the maximum value of the array
   */
  function max(array: number[]): number;
  /**
   * Returns the mean of the array
   */
  function mean(array: number[]): number;
  /**
   * Returns the mean squared error of the array
   */
  function meansqerr(array: number[]): number;
  /**
   * Returns the geometric mean of the array
   */
  function geomean(array: number[]): number;
  /**
   * Returns the median of the array
   */
  function median(array: number[]): number;
  /**
   * Returns an array of partial sums in the sequence
   */
  function cumsum(array: number[]): number[];
  /**
   * Returns an array of partial products in the sequence
   */
  function cumprod(array: number[]): number[];
  /**
   * Returns an array of the successive differences of the array
   */
  function diff(array: number[]): number[];
  /**
   * Returns an array of the ranks of the array
   */
  function rank(array: number[]): number[];
  /**
   * Returns the mode of the array. If there are multiple modes then mode() will return all of them
   */
  function mode(array: number[]): number | number[];
  /**
   * Returns the range of the array
   */
  function range(array: number[]): number;
  /**
   * Returns the variance of the array. By default, the population variance is calculated. Passing true to sample computes the sample variance instead
   */
  function variance(array: number[], sample?: boolean): number;
  /**
   * Returns the pooled (sample) variance of an array of arrays. Assumes the population variance of the arrays are the same.
   */
  function pooledvariance(arrayOfArrays: number[][]): number;
  /**
   * Returns the deviation of the array
   */
  function deviation(array: number[]): number[];
  /**
   * Returns the standard deviation of the array. By default, the population standard deviation is returned. Passing true to sample returns the sample standard deviation
   */
  function stdev(array: number[], sample?: boolean): number;
  /**
   * Returns the pooled (sample) standard deviation of an array of arrays. Assumes the population standard deviation of the arrays are the same
   */
  function pooledstdev(arrayOfArrays: number[][]): number;
  /**
   * Returns the mean absolute deviation of the array
   */
  function meandev(array: number[]): number;
  /**
   * Returns the median absolute deviation of the array
   */
  function meddev(array: number[]): number;
  /**
   * Returns the skewness of the array (third standardized moment)
   */
  function skewness(array: number[]): number;
  /**
   * Returns the excess kurtosis of the array (fourth standardized moment - 3)
   */
  function kurtosis(array: number[]): number;
  /**
   * Returns the coefficient of variation of the array
   */
  function coeffvar(array: number[]): number;
  /**
   * Returns the quartiles of the array
   */
  function quartiles(array: number[]): number[];
  /**
   * Like quartiles, but calculate and return arbitrary quantiles of the array or matrix (column-by-column)
   */
  function quantiles(arrayOfArrays: number[][]): number[];
  /**
   * Returns the k-th percentile of values in the array range, where k is in the range 0..1, exclusive. Passing true for the exclusive parameter excludes both endpoints of the range.
   */
  function percentile(array: number[], k: number, exclusive?: boolean): number;
  /**
   * The percentile rank of score in a given array. Returns the percentage of all values in dataArray that are less than (if kind == 'strict') or less or equal than (if kind == 'weak') score. Default is 'weak'.
   */
  function percentileOfScore(array: number[]): number;
  /**
   * The histogram data defined as the number of array elements found in equally sized bins across the range of array. Default number of bins is 4
   */
  function histogram(array: number[], bins?: number): number[];
  /**
   * Returns the covariance of array1 and array2
   */
  function covariance(array1: number[], array2: number[]): number;
  /**
   * Returns the population correlation coefficient of array1 and array2 (Pearson's Rho)
   */
  function corrcoeff(array1: number[], array2: number[]): number;

  // --------Distribution functions--------
  /**
   * Contains methods for the Beta distribution
   */
  class beta {
    /**
     * Returns the value of x in the Beta distribution with parameters alpha and beta
     */
    static pdf(x: number, alpha: number, beta: number): number;
    /**
     * Returns the value of x in the cdf for the Beta distribution with parameters alpha and beta
     */
    static cdf(x: number, alpha: number, beta: number): number;
    /**
     * Returns the value of p in the inverse of the cdf for the Beta distribution with parameters alpha and beta
     */
    static inv(p: number, alpha: number, beta: number): number;
    /**
     * Returns the mean of the Beta distribution with parameters alpha and beta
     */
    static mean(alpha: number, beta: number): number;
    /**
     * Returns the median of the Beta distribution with parameters alpha and beta
     */
    static median(alpha: number, beta: number): number;
    /**
     * Returns the mode of the Beta distribution with parameters alpha and beta
     */
    static mode(alpha: number, beta: number): number;
    /**
     * Returns a random number whose distribution is the Beta distribution with parameters alpha and beta
     */
    static sample(alpha: number, beta: number): number;
    /**
     * Returns the variance of the Beta distribution with parameters alpha and beta
     */
    static variance(alpha: number, beta: number): number;
  }
  /**
   * Contains methods for the (central) F distribution. In all cases, df1 is the "numerator degrees of freedom" and df2 is the "denominator degrees of freedom", which parameterize the distribtuion
   */
  class centralF {
    /**
     * Given x in the range [0, infinity), returns the probability density of the (central) F distribution at x
     */
    static pdf(x: number, df1: number, df2: number): number;
    /**
     * Given x in the range [0, infinity), returns the cumulative probability density of the central F distribution
     */
    static cdf(x: number, df1: number, df2: number): number;
    /**
     * Given p in [0, 1), returns the value of x for which the cumulative probability density of the central F distribution is p
     */
    static inv(p: number, df1: number, df2: number): number;
    /**
     * Returns the mean of the (Central) F distribution
     */
    static mean(df1: number, df2: number): number;
    /**
     * Returns the mode of the (Central) F distribution
     */
    static mode(df1: number, df2: number): number;
    /**
     * Returns a random number whose distribution is the (Central) F distribution
     */
    static sample(df1: number, df2: number): number;
    /**
     * Returns the variance of the (Central) F distribution
     */
    static variance(df1: number, df2: number): number;
  }
  /**
   * Contains methods for the Cauchy distribution
   */
  class cauchy {
    /**
     * Returns the value of x in the pdf of the Cauchy distribution with a location (median) of local and scale factor of scale
     */
    static pdf(x: number, local: number, scale: number): number;
    /**
     * Returns the value of x in the cdf of the Cauchy distribution with a location (median) of local and scale factor of scale
     */
    static cdf(x: number, local: number, scale: number): number;
    /**
     * Returns the value of p in the inverse of the cdf for the Cauchy distribution with a location (median) of local and scale factor of scale
     */
    static inv(p: number, local: number, scale: number): number;
    /**
     * Returns the value of the median for the Cauchy distribution with a location (median) of local and scale factor of scale
     */
    static median(local: number, scale: number): number;
    /**
     * Returns the value of the mode for the Cauchy distribution with a location (median) of local and scale factor of scale
     */
    static mode(local: number, scale: number): number;
    /**
     * Returns a random number whose distribution is the Cauchy distribution with a location (median) of local and scale factor of scale
     */
    static sample(local: number, scale: number): number;
    /**
     * Returns the value of the variance for the Cauchy distribution with a location (median) of local and scale factor of scale
     */
    static variance(local: number, scale: number): number;
  }
  /**
   * Contains methods for the Chi Square distribution
   */
  class chisquare {
    /**
     * Returns the value of x in the pdf of the Chi Square distribution with dof degrees of freedom
     */
    static pdf(x: number, dof: number): number;
    /**
     * Returns the value of x in the cdf of the Chi Square distribution with dof degrees of freedom
     */
    static cdf(x: number, dof: number): number;
    /**
     * Returns the value of x in the inverse of the cdf for the Chi Square distribution with dof degrees of freedom
     */
    static inv(p: number, dof: number): number;
    /**
     * Returns the value of the mean for the Chi Square distribution with dof degrees of freedom
     */
    static mean(dof: number): number;
    /**
     * Returns the value of the median for the Chi Square distribution with dof degrees of freedom
     */
    static median(dof: number): number;
    /**
     * Returns the value of the mode for the Chi Square distribution with dof degrees of freedom
     */
    static mode(dof: number): number;
    /**
     * Returns a random number whose distribution is the Chi Square distribution with dof degrees of freedom
     */
    static sample(dof: number): number;
    /**
     * Returns the value of the variance for the Chi Square distribution with dof degrees of freedom
     */
    static variance(dof: number): number;
  }
  /**
   * Contains methods for the Exponential distribution
   */
  class exponential {
    /**
     * Returns the value of x in the pdf of the Exponential distribution with the parameter rate (lambda)
     */
    static pdf(x: number, rate: number): number;
    /**
     * Returns the value of x in the cdf of the Exponential distribution with the parameter rate (lambda)
     */
    static cdf(x: number, rate: number): number;
    /**
     * Returns the value of p in the inverse of the cdf for the Exponential distribution with the parameter rate (lambda)
     */
    static inv(p: number, rate: number): number;
    /**
     * Returns the value of the mean for the Exponential distribution with the parameter rate (lambda)
     */
    static mean(rate: number): number;
    /**
     * Returns the value of the median for the Exponential distribution with the parameter rate (lambda)
     */
    static median(rate: number): number;
    /**
     * Returns the value of the mode for the Exponential distribution with the parameter rate (lambda)
     */
    static mode(rate: number): number;
    /**
     * Returns a random number whose distribution is the Exponential distribution with the parameter rate (lambda)
     */
    static sample(rate: number): number;
    /**
     * Returns the value of the variance for the Exponential distribution with the parameter rate (lambda)
     */
    static variance(rate: number): number;
  }
  /**
   * Contains methods for the Gamma distribution
   */
  class gamma {
    /**
     * Returns the value of x in the pdf of the Gamma distribution with the parameters shape (k) and scale (theta). Notice that if using the alpha beta convention, scale = 1/beta
     */
    static pdf(x: number, shape: number, scale: number): number;
    /**
     * Returns the value of x in the cdf of the Gamma distribution with the parameters shape (k) and scale (theta). Notice that if using the alpha beta convention, scale = 1/beta
     */
    static cdf(x: number, shape: number, scale: number): number;
    /**
     * Returns the value of p in the inverse of the cdf for the Gamma distribution with the parameters shape (k) and scale (theta). Notice that if using the alpha beta convention, scale = 1/beta
     */
    static inv(p: number, shape: number, scale: number): number;
    /**
     * Returns the value of the mean for the Gamma distribution with the parameters shape (k) and scale (theta). Notice that if using the alpha beta convention, scale = 1/beta
     */
    static mean(shape: number, scale: number): number;
    /**
     * Returns the value of the mode for the Gamma distribution with the parameters shape (k) and scale (theta). Notice that if using the alpha beta convention, scale = 1/beta
     */
    static mode(shape: number, scale: number): number;
    /**
     * Returns a random number whose distribution is the Gamma distribution with the parameters shape (k) and scale (theta). Notice that if using the alpha beta convention, scale = 1/beta
     */
    static sample(shape: number, scale: number): number;
    /**
     * Returns the value of the variance for the Gamma distribution with the parameters shape (k) and scale (theta). Notice that if using the alpha beta convention, scale = 1/beta
     */
    static variance(shape: number, scale: number): number;
  }
  /**
   * Contains methods for the Inverse-Gamma distribution
   */
  class invgamma {
    /**
     * Returns the value of x in the pdf of the Inverse-Gamma distribution with parametres shape (alpha) and scale (beta)
     */
    static pdf(x: number, shape: number, scale: number): number;
    /**
     * Returns the value of x in the cdf of the Inverse-Gamma distribution with parametres shape (alpha) and scale (beta)
     */
    static cdf(x: number, shape: number, scale: number): number;
    /**
     * Returns the value of p in the inverse of the cdf for the Inverse-Gamma distribution with parametres shape (alpha) and scale (beta)
     */
    static inv(p: number, shape: number, scale: number): number;
    /**
     * Returns the value of the mean for the Inverse-Gamma distribution with parametres shape (alpha) and scale (beta)
     */
    static mean(shape: number, scale: number): number;
    /**
     * Returns the value of the mode for the Inverse-Gamma distribution with parametres shape (alpha) and scale (beta)
     */
    static mode(shape: number, scale: number): number;
    /**
     * Returns a random number whose distribution is the Inverse-Gamma distribution with parametres shape (alpha) and scale (beta)
     */
    static sample(shape: number, scale: number): number;
    /**
     * Returns the value of the variance for the Inverse-Gamma distribution with parametres shape (alpha) and scale (beta)
     */
    static variance(shape: number, scale: number): number;
  }
  /**
   * Contains methods for the Kumaraswamy distribution
   */
  class kumaraswamy {
    /**
     * Returns the value of x in the pdf of the Kumaraswamy distribution with parameters a and b
     */
    static pdf(x: number, alpha: number, beta: number): number;
    /**
     * Returns the value of x in the cdf of the Kumaraswamy distribution with parameters a and b
     */
    static cdf(x: number, alpha: number, beta: number): number;
    /**
     * Returns the value of p in the inverse of the pdf for the Kumaraswamy distribution with parametres alpha and beta
     */
    static inv(p: number, alpha: number, beta: number): number;
    /**
     * Returns the value of the mean of the Kumaraswamy distribution with parameters alpha and beta
     */
    static mean(alpha: number, beta: number): number;
    /**
     * Returns the value of the median of the Kumaraswamy distribution with parameters alpha and beta
     */
    static median(alpha: number, beta: number): number;
    /**
     * Returns the value of the mode of the Kumaraswamy distribution with parameters alpha and beta
     */
    static mode(alpha: number, beta: number): number;
    /**
     * Returns the value of the variance of the Kumaraswamy distribution with parameters alpha and beta
     */
    static variance(alpha: number, beta: number): number;
  }
  /**
   * Contains methods for the Log-normal distribution
   */
  class lognormal {
    /**
     * Returns the value of x in the pdf of the Log-normal distribution with paramters mu (mean) and sigma (standard deviation)
     */
    static pdf(x: number, mu: number, sigma: number): number;
    /**
     * Returns the value of x in the cdf of the Log-normal distribution with paramters mu (mean) and sigma (standard deviation)
     */
    static cdf(x: number, mu: number, sigma: number): number;
    /**
     * Returns the value of x in the inverse of the cdf for the Log-normal distribution with paramters mu (mean of the Normal distribution) and sigma (standard deviation of the Normal distribution)
     */
    static inv(p: number, mu: number, sigma: number): number;
    /**
     * Returns the value of the mean for the Log-normal distribution with paramters mu (mean of the Normal distribution) and sigma (standard deviation of the Normal distribution)
     */
    static mean(mu: number, sigma: number): number;
    /**
     * Returns the value of the median for the Log-normal distribution with paramters mu (mean of the Normal distribution) and sigma (standard deviation of the Normal distribution)
     */
    static median(mu: number, sigma: number): number;
    /**
     * Returns the value of the mode for the Log-normal distribution with paramters mu (mean of the Normal distribution) and sigma (standard deviation of the Normal distribution)
     */
    static mode(mu: number, sigma: number): number;
    /**
     * Returns a random number whose distribution is the Log-normal distribution with paramters mu (mean of the Normal distribution) and sigma (standard deviation of the Normal distribution)
     */
    static sample(mu: number, sigma: number): number;
    /**
     * Returns the value of the variance for the Log-normal distribution with paramters mu (mean of the Normal distribution) and sigma (standard deviation of the Normal distribution)
     */
    static variance(mu: number, sigma: number): number;
  }
  /**
   * Contains methods for the Normal distribution
   */
  class normal {
    /**
     * Returns the value of x in the pdf of the Normal distribution with parameters mean and std (standard deviation)
     */
    static pdf(x: number, mean: number, std: number): number;
    /**
     * Returns the value of x in the cdf of the Normal distribution with parameters mean and std (standard deviation)
     */
    static cdf(x: number, mean: number, std: number): number;
    /**
     * Returns the value of p in the inverse cdf for the Normal distribution with parameters mean and std (standard deviation)
     */
    static inv(p: number, mean: number, std: number): number;
    /**
     * Returns the value of the mean for the Normal distribution with parameters mean and std (standard deviation)
     */
    static mean(mean: number, std: number): number;
    /**
     * Returns the value of the median for the Normal distribution with parameters mean and std (standard deviation)
     */
    static median(mean: number, std: number): number;
    /**
     * Returns the value of the mode for the Normal distribution with parameters mean and std (standard deviation)
     */
    static mode(mean: number, std: number): number;
    /**
     * Returns a random number whose distribution is the Normal distribution with parameters mean and std (standard deviation)
     */
    static sample(mean: number, std: number): number;
    /**
     * Returns the value of the variance for the Normal distribution with parameters mean and std (standard deviation)
     */
    static variance(mean: number, std: number): number;
  }
  /**
   * Contains methods for the Pareto distribution
   */
  class pareto {
    /**
     * Returns the value of x in the pdf of the Pareto distribution with parameters scale (x<sub>m</sub>) and shape (alpha)
     */
    static pdf(x: number, scale: number, shape: number): number;
    /**
     * Returns the value of x in the cdf of the Pareto distribution with parameters scale (x<sub>m</sub>) and shape (alpha)
     */
    static cdf(x: number, scale: number, shape: number): number;
    /**
     * Returns the inverse of the Pareto distribution with probability p, scale, shape
     */
    static inv(p: number, scale: number, shape: number): number;
    /**
     * Returns the value of the mean of the Pareto distribution with parameters scale (x<sub>m</sub>) and shape (alpha)
     */
    static mean(scale: number, shape: number): number;
    /**
     * Returns the value of the median of the Pareto distribution with parameters scale (x<sub>m</sub>) and shape (alpha)
     */
    static median(scale: number, shape: number): number;
    /**
     * Returns the value of the mode of the Pareto distribution with parameters scale (x<sub>m</sub>) and shape (alpha)
     */
    static mode(scale: number, shape: number): number;
    /**
     * Returns the value of the variance of the Pareto distribution with parameters scale (x<sub>m</sub>) and shape (alpha)
     */
    static variance(scale: number, shape: number): number;
  }
  /**
   * Contains methods for the Students' T distribution
   */
  class studentt {
    /**
     * Returns the value of x in the pdf of the Student's T distribution with dof degrees of freedom
     */
    static pdf(x: number, dof: number): number;
    /**
     * Returns the value of x in the cdf of the Student's T distribution with dof degrees of freedom
     */
    static cdf(x: number, dof: number): number;
    /**
     * Returns the value of p in the inverse of the cdf for the Student's T distribution with dof degrees of freedom
     */
    static inv(p: number, dof: number): number;
    /**
     * Returns the value of the mean of the Student's T distribution with dof degrees of freedom
     */
    static mean(dof: number): number;
    /**
     * Returns the value of the median of the Student's T distribution with dof degrees of freedom
     */
    static median(dof: number): number;
    /**
     * Returns the value of the mode of the Student's T distribution with dof degrees of freedom
     */
    static mode(dof: number): number;
    /**
     * Returns a random number whose distribution is the Student's T distribution with dof degrees of freedom
     */
    static sample(dof: number): number;
    /**
     * Returns the value of the variance of the Student's T distribution with dof degrees of freedom
     */
    static variance(dof: number): number;
  }
  /**
   * Contains methods for the Studentized range distribution
   */
  class tukey {
    /**
     * Returns the value of q in the cdf of the Studentized range distribution with nmeans number of groups nmeans and dof degrees of freedom
     */
    static cdf(q: number, nmeans: number, dof: number): number;
    /**
     * Returns the value of p in the inverse of the cdf for the Studentized range distribution with nmeans number of groups and dof degrees of freedom. Only accurate to 4 decimal places
     */
    static inv(p: number, nmeans: number, dof: number): number;
  }
  /**
   * Contains methods for the Weibull distribution
   */
  class weibull {
    /**
     * Returns the value x in the pdf for the Weibull distribution with parameters scale (lambda) and shape (k)
     */
    static pdf(x: number, scale: number, shape: number): number;
    /**
     * Returns the value x in the cdf for the Weibull distribution with parameters scale (lambda) and shape (k)
     */
    static cdf(x: number, scale: number, shape: number): number;
    /**
     * Returns the value of x in the inverse of the cdf for the Weibull distribution with parameters scale (lambda) and shape (k)
     */
    static inv(p: number, scale: number, shape: number): number;
    /**
     * Returns the value of the mean of the Weibull distribution with parameters scale (lambda) and shape (k)
     */
    static mean(scale: number, shape: number): number;
    /**
     * Returns the value of the median of the Weibull distribution with parameters scale (lambda) and shape (k)
     */
    static median(scale: number, shape: number): number;
    /**
     * Returns the mode of the Weibull distribution with parameters scale (lambda) and shape (k)
     */
    static mode(scale: number, shape: number): number;
    /**
     * Returns a random number whose distribution is the Weibull distribution with parameters scale (lambda) and shape (k)
     */
    static sample(scale: number, shape: number): number;
    /**
     * Returns the variance of the Weibull distribution with parameters scale (lambda) and shape (k)
     */
    static variance(scale: number, shape: number): number;
  }
  /**
   * Contains methods for the Uniform distribution
   */
  class uniform {
    /**
     * Returns the value of x in the pdf of the Uniform distribution from a to b
     */
    static pdf(x: number, a: number, b: number): number;
    /**
     * Returns the value of x in the cdf of the Uniform distribution from a to b
     */
    static cdf(x: number, a: number, b: number): number;
    /**
     * Returns the inverse of the uniform.cdf function; i.e. the value of x for which uniform.cdf(x, a, b) == p
     */
    static inv(p: number, a: number, b: number): number;
    /**
     * Returns the value of the mean of the Uniform distribution from a to b
     */
    static mean(a: number, b: number): number;
    /**
     * Returns the value of the median of the Uniform distribution from a to b
     */
    static median(a: number, b: number): number;
    /**
     * Returns the value of the mode of the Uniform distribution from a to b
     */
    static mode(a: number, b: number): number;
    /**
     * Returns a random number whose distribution is the Uniform distribution from a to b
     */
    static sample(a: number, b: number): number;
    /**
     * Returns the variance of the Uniform distribution from a to b
     */
    static variance(a: number, b: number): number;
  }
  /**
   * Contains methods for the Binomial distribution
   */
  class binomial {
    /**
     * Returns the value of k in the pdf of the  Binomial distribution with parameters n and p
     */
    static pdf(k: number, r: number, p: number): number;
    /**
     * Returns the value of x in the cdf of the Binomial distribution with parameters n and p
     */
    static cdf(x: number, r: number, p: number): number;
  }
  /**
   * Contains methods for the Negative Binomial distribution
   */
  class negbin {
    /**
     * Returns the value of k in the pdf of the Negative Binomial distribution with parameters r and p
     */
    static pdf(k: number, r: number, p: number): number;
    /**
     * Returns the value of x in the cdf of the Negative Binomial distribution with parameters r and p
     */
    static cdf(x: number, r: number, p: number): number;
  }
  /**
   * Contains methods for the Hypergeometric distribution
   */
  class hypgeom {
    /**
     * Returns the value of k in the pdf of the Hypergeometric distribution with parameters N (the population size), m (the success rate), and n (the number of draws)
     */
    static pdf(k: number, N: number, m: number, n: number): number;
    /**
     * Returns the value of x in the cdf of the Hypergeometric distribution with parameters N (the population size), m (the success rate), and n (the number of draws)
     */
    static cdf(x: number, N: number, m: number, n: number): number;
  }
  /**
   * Contains methods for the Poisson distribution
   */
  class poisson {
    /**
     * Returns the value of k in the pdf of the Poisson distribution with parameter l (lambda)
     */
    static pdf(k: number, l: number): number;
    /**
     * Returns the value of x in the cdf of the Poisson distribution with parameter l (lambda)
     */
    static cdf(x: number, l: number): number;
    /**
     * Returns a random number whose distribution is the Poisson distribution with parameter l (lambda)
     */
    static sample(l: number): number;
  }

  /**
   * Contains methods for the Triangular distribution
   */
  class triangular {
    /**
     * Returns the value of x in the pdf of the Triangular distribution with the parameters a, b, and c
     */
    static pdf(x: number, a: number, b: number, c: number): number;
    /**
     * Returns the value of x in the cdf of the Triangular distribution with the parameters a, b, and c
     */
    static cdf(x: number, a: number, b: number, c: number): number;
    /**
     * Returns the value of the mean of the Triangular distribution with the parameters a, b, and c
     */
    static mean(a: number, b: number, c: number): number;
    /**
     * Returns the value of the median of the Triangular distribution with the parameters a, b, and c
     */
    static median(a: number, b: number, c: number): number;
    /**
     * Returns the value of the mode of the Triangular distribution with the parameters a, b, and c
     */
    static mode(a: number, b: number, c: number): number;
    /**
     * Returns a random number whose distribution is the Triangular distribution with the parameters a, b, and c
     */
    static sample(a: number, b: number, c: number): number;
    /**
     * Returns the value of the variance of the Triangular distribution with the parameters a, b, and c
     */
    static variance(a: number, b: number, c: number): number;
  }
  /**
   * Contains methods for the arcsine distribution
   */
  class arcsine {
    /**
     * Returns the value of x in the pdf of the arcsine distribution from a to b
     */
    static pdf(x: number, a: number, b: number): number;
    /**
     * Returns the value of x in the cdf of the arcsine distribution from a to b
     */
    static cdf(x: number, a: number, b: number): number;
    /**
     *
     * Returns the inverse of the cdf function; i.e. the value of x for which arcsine.cdf(x, a, b) == p
     */
    static inv(p: number, a: number, b: number): number;
    /**
     * Returns the value of the mean of the arcsine distribution from a to b
     */
    static mean(a: number, b: number): number;
    /**
     * Returns the value of the medianof the arcsine distribution from a to b
     */
    static median(a: number, b: number): number;
    /**
     * Returns the value of the mode of the arcsine distribution from a to b
     */
    static mode(a: number, b: number): number;
    /**
     * Returns a random number whose distribution is the arcsine distribution from a to b
     */
    static sample(a: number, b: number): number;
    /**
     * Returns the value of the variance in the arcsine distribution from a to b
     */
    static variance(a: number, b: number): number;
  }
}
