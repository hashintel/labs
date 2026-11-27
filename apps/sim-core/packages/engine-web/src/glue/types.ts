import { AgentStateProxy } from "./AgentStateProxy";

export type AgentStateWrapper = import("../../wasm").AgentStateWrapper;
export type ContextWrapper = import("../../wasm").ContextWrapper;
export type WasmLib = typeof import("../../wasm");

export type NamedBehavior = {
  name: string;
  dependencies: string[];
  behavior: BehaviorFn;
};

export type BehaviorFn = (state: AgentStateProxy, context: Context) => void;

export type MessageHandler = {
  name: string;
  handler: MessageHandlerFn;
};

export type MessageHandlerFn = (
  state: MessageHandlerState,
  properties: Json
) => Promise<MessageHandlerState>;

export type MessageHandlerState = {
  get_messages: () => IncomingMessage[];
  remove_agent: (id: string) => void;
  add_agent: (agent: AgentState) => void;
  add_message: (message: IncomingMessage) => void;
};

export type JsMessageHandlerState = Omit<MessageHandlerState, "get_agents"> & {
  get_agents: () => AgentStateProxy[];
};

/**
 * JSON types are hard due to their recursive nature…
 * @see https://github.com/microsoft/TypeScript/issues/14174#issuecomment-518944393
 */
export type JsonPrimitive = string | number | boolean | null;
export interface JsonMap {
  [member: string]: JsonPrimitive | JsonArray | JsonMap;
}
export interface JsonArray extends Array<JsonPrimitive | JsonArray | JsonMap> {}
export type Json = JsonPrimitive | JsonMap | JsonArray;

export type SerializableAgentState = {
  // Engine states
  agent_id: string;
  agent_name?: string;
  behaviors?: string[];
  messages?: OutboundMessage[];
  position?: Vec3;
  velocity?: Vec3;
  search_radius?: number;
  // Viewer states
  direction?: Vec3;
  height?: number;
  scale?: Vec3;
  color?: string;
  geo_color?: string;
  geo_radius?: number;
  geo_opacity?: number;
  rgb?: Vec3;
  shape?: "box" | "cone";
  hidden?: boolean;
  lng_lat?: [number, number];
};

// Use this when you need to attach arbitrary fields to agent state
// Json is a self-referencing, recursive type and breaks Redux
export type AgentState = SerializableAgentState & {
  [id: string]: Json | undefined;
};

export type Vec3 = [number, number, number];

export type OutboundMessage = {
  type: string;
  to: string | string[];
  data?: any;
};

export type IncomingMessage = {
  from: string;
} & OutboundMessage;

export type Context = {
  messages: () => IncomingMessage[];
  neighbors: () => AgentState[];
  globals: () => Json;
  data: () => Json;
  step: () => number;
};

export const cacheStep = Symbol();

export type CachedAgentState = AgentState & {
  [cacheStep]: number;
};

export type AgentCache = {
  [cacheStep]: number;
  [id: string]: CachedAgentState;
};

export type InitContext = {
  globals: () => Json;
  data: () => Json;
};

export type InitFn = (context: InitContext) => AgentState[];
