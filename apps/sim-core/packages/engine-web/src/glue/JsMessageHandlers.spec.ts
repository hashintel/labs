import {
  AgentState,
  IncomingMessage,
  MessageHandler,
  NamedBehavior,
} from "./types";
import { Analyzer } from "../simulation/Analyzer";
import { Simulation } from "../simulation/Simulation";
const fetch = require("node-fetch");

describe("JS Message handlers", () => {
  test("should delete agent", async () => {
    const properties = {
      messageHandlers: ["delete_xyz"],
    };

    const initialState: AgentState[] = [
      {
        agent_id: "xyz",
        messages: [
          {
            to: ["delete_xyz"],
            type: "delete",
          },
        ],
      },
    ];

    const messageHandlers: MessageHandler[] = [
      {
        name: "delete_xyz",
        handler: async (state, props) => {
          state.remove_agent("xyz");
          return state;
        },
      },
    ];

    const analyzer = new Analyzer([]);
    const sim = new Simulation(
      initialState,
      properties,
      {},
      [],
      messageHandlers,
      analyzer
    );

    let i = 0;
    while (true) {
      const { state } = await sim.next_state();
      i += 1;
      if (i > 1) {
        break;
      }
      expect(state.length).toBe(0);
    }

    await sim.drop();
  });

  test("should add agent", async () => {
    const properties = {
      messageHandlers: ["add_xyz"],
    };
    const initialState: AgentState[] = [
      {
        agent_id: "abc",
        messages: [
          {
            to: ["add_xyz"],
            type: "trigger_add",
          },
        ],
      },
    ];

    const messageHandlers: MessageHandler[] = [
      {
        name: "add_xyz",
        handler: async (state, props) => {
          state.add_agent({
            agent_id: "xyz",
          });
          return state;
        },
      },
    ];

    const analyzer = new Analyzer([]);
    const sim = new Simulation(
      initialState,
      properties,
      {},
      [],
      messageHandlers,
      analyzer
    );

    let i = 0;
    while (true) {
      const { state } = await sim.next_state();
      i += 1;
      if (i > 1) {
        break;
      }
      expect(state.length).toBe(2);
    }

    await sim.drop();
  });

  test("should send messages", async () => {
    const properties = {
      messageHandlers: ["send_to_xyz"],
    };
    const initialState: AgentState[] = [
      {
        agent_id: "xyz",
        behaviors: ["check_message_received"],
        received: false,
        messages: [
          {
            to: ["send_to_xyz"],
            type: "trigger_send",
          },
        ],
      },
    ];

    const messageHandlers: MessageHandler[] = [
      {
        name: "send_to_xyz",
        handler: async (state, props) => {
          state.add_message({
            from: "send",
            type: "sent",
            to: ["xyz"],
            data: { message: "received" },
          });
          return state;
        },
      },
    ];

    const checkMessageReceived: NamedBehavior = {
      name: "check_message_received",
      dependencies: [],
      behavior: (state, context) => {
        const messages = context.messages();
        state.set(
          "received",
          messages.reduce(
            (v: boolean, m: IncomingMessage) =>
              v ||
              (m.from === "send" &&
                m.type === "sent" &&
                m.data.message === "received"),
            false
          )
        );
        state.addMessage("send_to_xyz", "trigger_send");
        return state;
      },
    };

    const analyzer = new Analyzer([]);
    const sim = new Simulation(
      initialState,
      properties,
      {},
      [checkMessageReceived],
      messageHandlers,
      analyzer
    );

    let i = 0;
    while (true) {
      const { state } = await sim.next_state();
      i += 1;
      if (i > 2) {
        break;
      }

      expect(state[0].received).not.toBeFalsy();
    }

    await sim.drop();
  });

  test("should be able to async", async () => {
    const properties = {
      messageHandlers: ["timeout"],
    };
    const initialState: AgentState[] = [
      {
        agent_id: "test",
        messages: [
          {
            to: ["timeout"],
            type: "trigger_timeout",
          },
        ],
      },
    ];

    const messageHandlers: MessageHandler[] = [
      {
        name: "timeout",
        handler: async (state, props) => {
          const timeout = await new Promise((res, _) =>
            setTimeout(() => res("xyz"), 10)
          );
          state.add_agent({
            agent_id: timeout as string,
          });
          return state;
        },
      },
    ];

    const analyzer = new Analyzer([]);
    const sim = new Simulation(
      initialState,
      properties,
      {},
      [],
      messageHandlers,
      analyzer
    );

    let i = 0;
    while (true) {
      const { state } = await sim.next_state();
      i += 1;
      if (i > 1) {
        break;
      }
      expect(state.length).toBe(2);
      expect(state[1].agent_id).toBe("xyz");
    }

    await sim.drop();
  });

  test("should be able to fetch async", async () => {
    const properties = {
      messageHandlers: ["fetch"],
    };
    const initialState: AgentState[] = [
      {
        agent_id: "test",
        to: ["fetch"],
        type: "trigger_fetch",
      },
    ];

    const messageHandlers: MessageHandler[] = [
      {
        name: "fetch",
        handler: async (state, props) => {
          // jk we don't want to do this for every test.
          // let timeout = await fetch("http://numbersapi.com/123")
          // .then((r: any) => r.text())

          const timeout = await Promise.resolve("some random fact");
          state.add_agent({
            agent_id: "test2",
            random: timeout as string,
          });

          return state;
        },
      },
    ];

    const analyzer = new Analyzer([]);
    const sim = new Simulation(
      initialState,
      properties,
      {},
      [],
      messageHandlers,
      analyzer
    );

    let i = 0;
    while (true) {
      const { state } = await sim.next_state();
      i += 1;
      if (i > 1) {
        break;
      }
      expect(state.length).toBe(1);
      expect(state[0].random).not.toBeNull();
    }

    await sim.drop();
  });

  test("should receive messages", async () => {
    const properties = {
      messageHandlers: ["receiver"],
    };
    const initialState: AgentState[] = [
      {
        agent_id: "xyz",
        behaviors: ["send_message"],
        received: false,
        messages: [
          {
            to: ["receiver"],
            type: "test_receiver",
            data: {
              sent: true,
            },
          },
        ],
      },
    ];

    const messageHandlers: MessageHandler[] = [
      {
        name: "receiver",
        handler: async (state, props) => {
          expect(state.get_messages().length).toBeGreaterThan(0);
          expect(state.get_messages()[0].data.sent).toBeTruthy();
          return state;
        },
      },
    ];

    const sendMessage: NamedBehavior = {
      name: "send_message",
      dependencies: [],
      behavior: (state, context) => {
        state.addMessage("receiver", "test", { sent: true });
        return state;
      },
    };

    const analyzer = new Analyzer([]);
    const sim = new Simulation(
      initialState,
      properties,
      {},
      [sendMessage],
      messageHandlers,
      analyzer
    );

    let i = 0;
    while (true) {
      const { state } = await sim.next_state();
      i += 1;
      if (i > 5) {
        break;
      }
    }

    await sim.drop();
  });

  test("should receive messages on two handlers", async () => {
    const properties = {
      messageHandlers: ["receiver", "receiver2"],
    };
    const initialState: AgentState[] = [
      {
        agent_id: "xyz",
        behaviors: ["send_message"],
        received: false,
        messages: [
          {
            to: ["receiver", "receiver2"],
            type: "test_receiver",
            data: {
              sent: true,
            },
          },
        ],
      },
    ];

    const messageHandlers: MessageHandler[] = [
      {
        name: "receiver",
        handler: async (state, props) => {
          expect(state.get_messages().length).toBeGreaterThan(0);
          expect(state.get_messages()[0].data.sent).toBeTruthy();
          return state;
        },
      },
      {
        name: "receiver2",
        handler: async (state, props) => {
          expect(state.get_messages().length).toBeGreaterThan(0);
          expect(state.get_messages()[0].data.sent).toBeTruthy();
          return state;
        },
      },
    ];

    const sendMessage: NamedBehavior = {
      name: "send_message",
      dependencies: [],
      behavior: (state, context) => {
        state.set("messages", [
          {
            to: ["receiver", "receiver2"],
            type: "test",
            data: { sent: true },
          },
        ]);
      },
    };

    const analyzer = new Analyzer([]);
    const sim = new Simulation(
      initialState,
      properties,
      {},
      [sendMessage],
      messageHandlers,
      analyzer
    );

    let i = 0;
    while (true) {
      const { state } = await sim.next_state();
      i += 1;
      if (i > 5) {
        break;
      }
    }

    await sim.drop();
  });

  test("should only use handlers specified in properties", async () => {
    const properties = {
      messageHandlers: [],
    };

    const initialState: AgentState[] = [
      {
        agent_id: "test",
        messages: [
          {
            to: ["add_xyz"],
            type: "trigger_add",
          },
        ],
      },
    ];

    const messageHandlers: MessageHandler[] = [
      {
        name: "add_xyz",
        handler: async (state, props) => {
          state.add_agent({
            agent_id: "xyz",
          });
          return state;
        },
      },
    ];

    const analyzer = new Analyzer([]);
    const sim = new Simulation(
      initialState,
      {},
      {},
      [],
      messageHandlers,
      analyzer
    );

    let i = 0;
    while (true) {
      const { state } = await sim.next_state();
      i += 1;
      if (i > 5) {
        break;
      }

      expect(state.length).toBe(1);
    }

    await sim.drop();
  });
});
