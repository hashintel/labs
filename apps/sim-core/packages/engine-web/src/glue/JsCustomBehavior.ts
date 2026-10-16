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

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    if ("message" in err && typeof (err as any).message === "string") {
      return (err as any).message;
    }
    try {
      return JSON.stringify(err);
    } catch {
      // fall through
    }
  }
  return String(err);
}

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
        const msg = extractErrorMessage(err);
        throw new Error(
          `error setting agent state after behavior ${this.name}: ${msg}`
        );
      }
    } catch (e) {
      const msg = extractErrorMessage(e);
      const err: Error & { args?: unknown } = new Error(msg);
      try {
        err.args = {
          context: {
            messages: JSON.parse(JSON.stringify(context.messages())),
            neighbors: JSON.parse(JSON.stringify(context.neighbors())),
          },
        };
      } catch {
        // context accessors may fail if WASM state is corrupted
      }
      throw err;
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
        let agent_id = "unknown";
        try {
          agent_id = state.wrapper.get("agent_id");
        } catch {
          // wrapper may be in a bad state
        }
        const msg = extractErrorMessage(err);
        throw new Error(
          `could not set state variable '${key}' to value ${JSON.stringify(
            value
          )} on agent with id '${agent_id}': ${msg}`
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
