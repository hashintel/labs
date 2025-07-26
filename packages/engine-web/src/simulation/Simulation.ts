import {
  AgentState,
  JsCustomBehaviors,
  JsMessageHandlers,
  Json,
  MessageHandler,
  NamedBehavior,
} from "../glue";
import { Analyzer } from "./Analyzer";
import { wasm } from "./utils";

// This syntax means that we only want the type signature.
type StateIteratorWrapper = import("../../wasm").StateIteratorWrapper;

export class Simulation {
  private properties: Json;
  private datasets: Json;
  private customBehaviors: JsCustomBehaviors;
  private messageHandlers: JsMessageHandlers;
  private analyzer: Analyzer;

  // we have to mark them with ! because initialization happens
  // in 'prepare'.
  private latestState!: AgentState[];
  private stateIteratorWrapper!: StateIteratorWrapper;

  private ready: Promise<void> | false;
  private readyError?: any;

  constructor(
    initialState: AgentState[],
    properties: Json,
    datasets: Json,
    customBehaviors: NamedBehavior[],
    messageHandlers: MessageHandler[],
    analyzer: Analyzer,
  ) {
    this.datasets = datasets;
    this.properties = properties;
    this.customBehaviors = new JsCustomBehaviors(
      customBehaviors,
      properties,
      datasets,
    );
    this.messageHandlers = new JsMessageHandlers(messageHandlers);
    this.analyzer = analyzer;
    this.ready = this.prepare(initialState);
  }

  public async current() {
    await this.ready;
    return this.latestState;
  }

  public async next_state() {
    const hash = await wasm();
    await this.checkReady();
    if (!this.stateIteratorWrapper) {
      const err = new Error();
    }
    const iter = this.stateIteratorWrapper.get_iter();

    const state = hash.next_state(iter);
    this.latestState = await state;
    const stop = this.customBehaviors.updateAgentCache(this.latestState);
    this.analyzer.analyze(this.latestState);

    return {
      state: this.latestState,
      outputs: this.analyzer.outputs(),
      earlyStop: stop !== null,
      stopMessage: stop === null ? null : stop.data,
    };
  }

  public async updateProperties(props: Json) {
    this.customBehaviors.updateProperties(props);
  }

  public async drop() {
    const err = new Error();
    try {
      await this.checkReady();
    } catch (e) {
      return;
    }

    if (this.stateIteratorWrapper) {
      this.stateIteratorWrapper.free();
    }
    this.ready = false;
  }

  private async prepare(initialState: AgentState[]) {
    try {
      const hash = await wasm();

      this.stateIteratorWrapper = hash.start_simulation(
        initialState,
        this.properties,
        this.datasets,
        this.customBehaviors,
        this.messageHandlers,
      );
      this.latestState = this.stateIteratorWrapper.initial_state();
      this.customBehaviors.updateAgentCache(this.latestState);
      this.analyzer.analyze(this.latestState);
    } catch (e) {
      this.ready = Promise.resolve();
      await this.drop();
      this.readyError = e;
    }
  }

  private async checkReady() {
    await this.ready;
    if (this.readyError) {
      throw this.readyError;
    }
    if (!this.ready) {
      throw new Error("Cannot reuse a dropped Simulation");
    }
  }
}
