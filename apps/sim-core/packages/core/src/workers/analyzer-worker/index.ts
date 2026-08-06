import RegisterPromiseWorker from "promise-worker-transferable/register";
import { AnalyzerRunner } from "@hashintel/engine-web";

const runner = new AnalyzerRunner();

RegisterPromiseWorker(async (message) => {
  // Validate the message is something we care about
  if (typeof message === "object") {
    if ((message as {}).hasOwnProperty("type")) {
      return runner.handleRequest(message);
    }
  }
});
