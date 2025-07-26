type AgentStateWrapper = import("../../wasm").AgentStateWrapper;

import { AgentStateProxy } from "./AgentStateProxy";
import {
  IncomingMessage,
  Json,
  MessageHandler,
  MessageHandlerFn,
  MessageHandlerState,
} from "./types";
import { MessageHandlerStateWrapper } from "./MessageHandlerStateWrapper";

export class JsMessageHandler {
  public name: string;
  private inner: MessageHandlerFn;

  constructor(src: MessageHandler) {
    this.name = src.name;
    this.inner = src.handler;
  }

  public handle(state: MessageHandlerState, properties: Json) {
    return this.inner(state, properties).then(
      (mh) => new MessageHandlerStateWrapper(mh),
    );
  }
}
