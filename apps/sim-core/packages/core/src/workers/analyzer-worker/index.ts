import RegisterPromiseWorker from "promise-worker-transferable/register";
import { AnalyzerRunner } from "@hashintel/engine-web";

const runner = new AnalyzerRunner();

RegisterPromiseWorker((message) => {
  // Validate the message is something we care about
  if (typeof message === "object") {
    if (Object.prototype.hasOwnProperty.call(message, "type")) {
      return runner.handleRequest(message);
    }
  }
});
