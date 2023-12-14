import { AgentState } from "../../../glue";
import { AgentStateProxy } from "../../../glue/AgentStateProxy";
import { Context, Json } from "../../..";
import { convertToObject } from "../util";

export class PyStateWrapper {
  currentState: AgentStateProxy | undefined;

  get(key: string) {
    if (!this.currentState) {
      throw new Error("Couldn't get");
    }
    return JSON.stringify(this.currentState.get(key));
  }
  set(key: string, value: any) {
    if (!this.currentState) {
      throw new Error("Couldn't set");
    }
    // Pyodide converts Python dicts to JS Maps, but we need plain objects so do
    // a manual conversion.
    // TODO: as of Pyodide 0.17.0, this manual conversion is required. But, future
    // versions may provide the option of choosing plain objects over Maps.
    this.currentState.set(key, convertToObject(value));
  }
  add_message(to: string | string[], type: string, data: any) {
    if (!this.currentState) {
      throw new Error("Couldn't set");
    }
    this.currentState.addMessage(to, type, convertToObject(data));
  }
  behavior_index() {
    if (!this.currentState) {
      throw new Error("Couldn't set");
    }
    return this.currentState.behaviorIndex();
  }
}

export class PyContextWrapper {
  context: Context | undefined;

  neighbors() {
    return this.context?.neighbors().map((neighbor) => neighbor.agent_id);
  }

  getNeighbors(ids: string[] | undefined) {
    if (ids === undefined || ids[0] === undefined) {
      return [];
    }

    const ret = this.context
      ?.neighbors()
      .filter(
        (neighbor) => neighbor.agent_id && ids.includes(neighbor.agent_id),
      )
      .map((n) => JSON.stringify(n));
    return ret;
  }

  getNeighborKey(id: string, key: string) {
    const neighbors = this.context?.neighbors() as
      | (AgentState & { [id: string]: Json }[]) // so we can index-on-the-fly
      | undefined;

    return JSON.stringify(
      neighbors?.find((neighbor) => neighbor.agent_id === id)?.[key],
    );
  }

  messages() {
    return this.context?.messages();
  }

  step() {
    return this.context?.step();
  }
}
