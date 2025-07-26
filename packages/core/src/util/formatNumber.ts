const formatter = new Intl.NumberFormat("en-GB");

export const formatNumber = (numSteps: number) => formatter.format(numSteps);
