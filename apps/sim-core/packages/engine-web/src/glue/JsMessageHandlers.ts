import { JsMessageHandler } from "./JsMessageHandler";
import { MessageHandler } from "./types";

export class JsMessageHandlers {
  private messageHandlers: JsMessageHandler[];

  constructor(messageHandlers: MessageHandler[]) {
    this.messageHandlers = messageHandlers.map((m) => new JsMessageHandler(m));
  }

  len() {
    return this.messageHandlers.length;
  }

  handler(i: number) {
    return this.messageHandlers[i];
  }
}
