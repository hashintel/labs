import { MessageHandlerState } from "./types";

export class MessageHandlerStateWrapper {
  inner: MessageHandlerState;

  constructor(inner: MessageHandlerState) {
    this.inner = inner;
  }

  get_inner() {
    return this.inner;
  }
}
