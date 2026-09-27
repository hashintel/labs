import { AgentState } from "../../glue";
import { Analyzer, OutputDefinition, Outputs } from "../../simulation";
import { PlotDefinition } from "./plots";
import { SimulationStates } from "..";
import { evalAnalysis } from "./evalAnalysis";

export class AnalyzerRunner {
  analyzer: Analyzer = new Analyzer([]);
  outputDef: OutputDefinition[] = [];
  plots: PlotDefinition[] = [];

  handleRequest(request: AnalyzerRequest): AnalyzerResponse {
    switch (request.type) {
      case "analyze":
        return {
          type: "analyze",
          outputs: Object.values(request.data).map((a) =>
            this.analyzer.analyze(a)
          ),
        };

      case "setAnalysisSrc":
        const { outputs, plots } = evalAnalysis(request.src);

        this.analyzer = new Analyzer(outputs);

        return { type: "setAnalysisSrc", plots };

      default:
        throw new Error("Failed to analyze, incorrect message type");
    }
  }
}

export type AnalyzerRequest =
  | {
      type: "analyze";
      data: SimulationStates;
    }
  | {
      type: "setAnalysisSrc";
      src: string;
    };

export type AnalyzerResponse =
  | {
      type: "analyze";
      outputs: Outputs[];
    }
  | {
      type: "setAnalysisSrc";
      plots: PlotDefinition[];
    };
