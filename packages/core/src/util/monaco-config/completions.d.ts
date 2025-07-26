/* eslint-disable */
declare type AgentField =
  | "agent_id"
  | "agent_name"
  | "behaviors"
  | "messages"
  | "position"
  | "direction"
  | "search_radius"
  | "alive"
  | "height"
  | "scale"
  | "color"
  | "rgb"
  | "shape"
  | "lng_lat";

declare interface AgentState {
  /**
   * Return the value of field in the agent's state
   */
  get: (field: AgentField) => any;
  /**
   * Set the value of field to val in the agent's state
   */
  set: (field: AgentField, val: any) => void;
  /**
   * Append a message to the agent's "messages" field. The message is formatted as { to, type, data }
   */
  addMessage: (to: string | string[], type: string, data?: any) => void;
  /**
   * Replace the value of field by appling func to the current value
   */
  modify: (field: AgentField, func: (val: any) => any) => void;

  /**
   * Return the index of the currently executing behavior in the agent's behavior chain.
   */
  behaviorIndex: () => number;
}

declare interface AgentContext {
  /**
   *  Return an array of all neighbors visible to the agent
   */
  neighbors: () => any;
  /**
   * Return an object containing all global variables defined in globals.json
   */
  globals: () => any;
  /**
   * Return an array of all messages sent to the agent in the previous time step
   */
  messages: () => any;
  /**
   * Return an object containing all datasets imported to the simulation. Access individual datasets by their names
   */
  data: () => any;

  /**
   * Return the current step number of the simulation.
   */
  step: () => number;
}

declare interface Topology {
  x_bounds: number[] | undefined;
  y_bounds: number[] | undefined;
  z_bounds: number[] | undefined;
}

declare type Agent = {
  [key: string]: any;
};

declare type AgentFunction = () => Agent[];

declare interface InitContext {
  /**
   * Return an object containing all global variables defined in globals.json
   */
  globals: () => any;

  /**
   * Return an object containing all datasets imported to the simulation. Access individual datasets by their names
   */
  data: () => any;
}
