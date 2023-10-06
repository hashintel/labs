import { cloneDeep } from "lodash";

import { AgentStateWrapper } from "./../../wasm/bundler/hash";

export class AgentStateProxy {
  public wrapper: AgentStateWrapper;

  // contains the bits of AgentState that have been moved into JS
  public cache: Map<string, any> = new Map();

  constructor(wrapper: AgentStateWrapper) {
    this.wrapper = wrapper;

    return new Proxy(this, {
      // dot-notation for assignment
      set(target: any, property: string, value: any) {
        target.cache.set(property, value);
        return true;
      },
      get(target: any, property: string) {
        if (property in target) {
          if (typeof target[property] === "function") {
            return target[property].bind(target);
          } else {
            return target[property];
          }
        } else {
          const cached = target.cache.get(property);
          if (cached !== undefined) {
            return cached;
          }

          const value = target.wrapper.get(property);
          target.cache.set(property, value);
          return value;
        }
      },
    });
  }

  get(key: string) {
    if (arguments.length !== 1) {
      throw new Error("state.get only takes a key argument");
    }

    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cloneDeep(cached);
    }

    const value = this.wrapper.get(key);
    this.cache.set(key, value);
    return cloneDeep(value);
  }

  set(key: string, value: any) {
    if (arguments.length !== 2) {
      throw new Error("state.set only takes two arguments - key, and value");
    }

    const cloned = cloneDeep(value);
    this.cache.set(key, cloned);
    return true;
  }

  modify(key: string, fn: (val: any) => any) {
    this.set(key, fn(this.get(key)));
  }

  addMessage(to: string | string[], type: string, data?: any) {
    const messages = this.cache.get("messages");
    if (messages === undefined) {
      this.wrapper.add_message(to, type, data);
    } else {
      const message = {
        to: [to],
        type,
        data,
      };
      messages.push(message);
    }
  }

  behaviorIndex() {
    return this.wrapper.behavior_index();
  }
}
