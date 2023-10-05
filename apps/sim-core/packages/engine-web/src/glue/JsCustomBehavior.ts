import {
  AgentCache,
  AgentStateWrapper,
  BehaviorFn,
  Context,
  ContextWrapper,
  Json,
  NamedBehavior,
  cacheStep,
} from "./types";
import { AgentStateProxy } from "./AgentStateProxy";

export class JsCustomBehavior {
  public name: string;
  public dependencies: string[];

  private inner: BehaviorFn;
  private properties: Json;
  private datasets: Json;
  private agentCache: AgentCache;

  constructor(
    src: NamedBehavior,
    properties: Json,
    datasets: Json,
    agentCache: AgentCache
  ) {
    this.name = src.name;
    this.dependencies = src.dependencies;
    this.inner = src.behavior;
    this.properties = properties;
    this.datasets = datasets;
    this.agentCache = agentCache;
  }

  public apply(
    stateWrapper: AgentStateWrapper,
    contextWrapper: ContextWrapper
  ) {
    const context: Context = {
      messages: () => contextWrapper.messages(),
      neighbors: () => this.retrieveNeighbors(contextWrapper.neighbors()),
      globals: () => this.properties,
      data: () => this.datasets,
      step: () => this.agentCache[cacheStep],
    };
    const state = new AgentStateProxy(stateWrapper);
    try {
      // Mutate state with the actual function
      this.inner(state, context);
      // All changes to agent state are persisted in
      // a local cache so as to avoid unnecessarily
      // crossing the Rust-JS boundary too many times.
      // This local cache must be flushed into the
      // Rust agent state in the end.
      try {
        this.flushCache(state);
      } catch (err) {
        // Errors from flushing to Rust do not go through our extended EvalError
        // We need to add information about the behavior and cause
        throw new Error(
          `error setting agent state after behavior ${this.name}: ${err.message}`
        );
      }
    } catch (e) {
      /**
       * @todo this context is lost when stringifying in WasmRequestHandler
       *    figure out why and do something about it, or stop adding it.
       */
      e.args = {
        context: {
          messages: JSON.parse(JSON.stringify(context.messages())),
          neighbors: JSON.parse(JSON.stringify(context.neighbors())),
          // do not copy properties: it might be tens of megabytes!
          // use the copy in the main thread.
        },
      };
      throw e;
    } finally {
      /**
       * Make sure to free memory!
       * We are given these glorious rust objects, taking ownership
       * Unlike rust, these are not freed when the scope closes. Instead, we
       * need to free them MANUALLY.
       *
       * More context:
       * https://github.com/rustwasm/wasm-bindgen/blob/ebc1e92fc3bcfd5cc2a12f338852c43cdeab84db/guide/src/reference/weak-references.md
       */
      state.wrapper.free();
      contextWrapper.free();
    }
  }

  private flushCache(state: AgentStateProxy) {
    state.cache.forEach((value, key) => {
      try {
        state.wrapper.set(key, value);
      } catch (err) {
        const agent_id = state.wrapper.get("agent_id");
        throw new Error(
          `could not set state variable '${key}' to value ${JSON.stringify(
            value
          )} on agent with id '${agent_id}': ${err.message}`
        );
      }
    });
  }

  public updateProperties(props: Json) {
    this.properties = props;
  }

  private retrieveNeighbors(neighbor_ids: string[]) {
    const currentStep = this.agentCache[cacheStep];
    return neighbor_ids.map((id) => {
      const neighbor = this.agentCache[id];
      if (!neighbor) {
        throw new Error(`Cache Error: neighbor ${id} not found`);
      }
      if (neighbor[cacheStep] !== currentStep) {
        throw new Error(`Cache Error: neighbor ${id} is outdated`);
      }
      return neighbor;
    });
  }
}
