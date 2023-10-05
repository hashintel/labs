import { OutputSeries } from "@hashintel/engine-web";

export const outputsToCsv = (outputs: OutputSeries) => {
  const metricNames = Object.keys(outputs);

  if (metricNames.length < 1) {
    return "";
  }

  let csvString = `Step,${metricNames.join(",")}\n`;

  for (let stepNum = 0; stepNum < outputs[metricNames[0]].length; stepNum++) {
    csvString += `${stepNum},${metricNames
      .map((metric) => outputs[metric][stepNum])
      .join(",")}\n`;
  }

  return csvString;
};
