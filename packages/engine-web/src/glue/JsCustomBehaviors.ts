import {
  AgentCache,
  AgentState,
  CachedAgentState,
  Json,
  NamedBehavior,
  cacheStep,
} from "./types";
import { JsCustomBehavior } from "./JsCustomBehavior";

export interface StopSim {
  data: any;
}

export class JsCustomBehaviors {
  private behaviors: JsCustomBehavior[];
  private readonly agentCache: AgentCache;

  constructor(behaviors: NamedBehavior[], properties: Json, datasets: Json) {
    this.agentCache = {
      [cacheStep]: 0,
    };
    this.behaviors = behaviors.map(
      (b) => new JsCustomBehavior(b, properties, datasets, this.agentCache),
    );
  }

  // This code matches the code that handles messages to HASH
  // in handle_hash_messages, in the hashintel-core package.
  // Please, make sure this method and that function are in sync,
  // or the cache will fail.
  // Note: don't need to do this for the "stop" message
  updateAgentCache(agents: AgentState[]) {
    const currentStep = this.agentCache[cacheStep] + 1;
    this.agentCache[cacheStep] = currentStep;
    const agentsToRemove = [];
    let stop: StopSim | null = null;
    for (const agent of agents) {
      for (const msg of agent.messages || []) {
        if (
          msg.type === "create_agent" &&
          ((Array.isArray(msg.to) &&
            msg.to.map((to) => to.toLowerCase()).includes("hash")) ||
            (typeof msg.to === "string" &&
              msg.to.toLowerCase().includes("hash")))
        ) {
          const cached: CachedAgentState = msg.data;
          cached[cacheStep] = currentStep;
          this.agentCache[msg.data.agent_id] = msg.data;
        }
        if (
          msg.type === "remove_agent" &&
          ((Array.isArray(msg.to) &&
            msg.to.map((to) => to.toLowerCase()).includes("hash")) ||
            (typeof msg.to === "string" &&
              msg.to.toLowerCase().includes("hash")))
        ) {
          agentsToRemove.push(msg.data.agent_id);
        }
        // Keep only the first stop message, if found. Since any agent can send a "stop",
        // we don't make any guarantees about which message is taken.
        if (msg.type === "stop" && is_hash_msg(msg.to) && !stop) {
          stop = { data: msg.data };
        }
      }
      const cached = agent as CachedAgentState;
      cached[cacheStep] = currentStep;
      this.agentCache[agent.agent_id!] = cached;
    }
    for (const killedId of agentsToRemove) {
      delete this.agentCache[killedId];
    }

    return stop;
  }

  public updateProperties(props: Json) {
    this.behaviors.forEach((b) => b.updateProperties(props));
  }

  // wasm-bindgen-friendly methods

  len() {
    return this.behaviors.length;
  }

  behavior(i: number) {
    return this.behaviors[i];
  }
}

const is_hash_msg = (to: string | string[]) => {
  if (Array.isArray(to)) {
    return to.map((to) => to.toLowerCase()).includes("hash");
  }
  return to.toLowerCase() === "hash";
};
