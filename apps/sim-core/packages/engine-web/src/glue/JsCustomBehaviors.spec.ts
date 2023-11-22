import { AgentState, NamedBehavior } from "./types";
import { Analyzer } from "../simulation/Analyzer";
import { Simulation } from "../simulation/Simulation";

async function* runner(sim: Simulation) {
  while (true) {
    yield await sim.next_state();
  }
}

describe("JS-side cache", () => {
  test("should handle added agents", async () => {
    const initialState: AgentState[] = [
      {
        agent_id: "test",
        step: 0,
        position: [0, 0, 0],
        behaviors: ["check-neighbors", "generate"],
      },
    ];
    const properties = {
      topology: {
        search_radius: 5,
      },
    };
    const behaviors: NamedBehavior[] = [
      {
        name: "generate",
        dependencies: [],
        behavior: (state) => {
          state.set("step", (state.get("step") as number) + 1);
          if (state.get("step") > 2) {
            return state;
          }
          state.modify("messages", (messages) =>
            messages.concat([
              {
                to: ["hash"],
                type: "create_agent",
                data: {
                  step: state.get("step"),
                  position: [
                    0,
                    0,
                    state.get("position")![2] + state.get("step"),
                  ],
                  behaviors: ["check-neighbors", "generate"],
                },
              },
            ]),
          );
          return state;
        },
      },
      {
        name: "check-neighbors",
        dependencies: [],
        behavior: (state, context) => {
          context.neighbors().forEach((n) => {
            if (n.step !== state.get("step")) {
              throw new Error("Cache error");
            }
          });
        },
      },
    ];
    const analyzer = new Analyzer([]);
    const sim = new Simulation(
      initialState,
      properties,
      {},
      behaviors,
      [],
      analyzer,
    );

    let step = 0;
    for await (const { state } of runner(sim)) {
      step += 1;
      for (const agent of state) {
        if (agent.step !== step) {
          throw new Error(
            `steps not updated correctly: ${agent.agent_id} ${agent.step}`,
          );
        }
      }
      if (step > 4) {
        break;
      }
    }
  });

  test("should handle removed and then added agents", async () => {
    const initialState: AgentState[] = [
      {
        agent_id: "test",
        step: 0,
        position: [0, 0, 0],
        behaviors: ["make mess"],
      },
    ];
    const properties = {
      topology: {
        search_radius: 5,
      },
    };
    const behaviors: NamedBehavior[] = [
      {
        name: "make mess",
        dependencies: [],
        behavior: (state, context) => {
          if ((state.get("step") as number) % 2 === 0) {
            const messages = state.get("messages");
            messages.push({
              to: ["hash"],
              type: "create_agent",
              data: {
                step: (state.get("step") as number) + 1,
                agent_id: "created",
                position: [0, 0, 1],
              },
            });
            state.set("messages", messages);
          } else {
            if (context.neighbors()[0].step !== state.get("step")) {
              throw new Error("cache error");
            }
            const messages = state.get("messages");
            messages.push({
              to: ["hash"],
              type: "remove_agent",
              data: {
                agent_id: "created",
              },
            });
            state.set("messages", messages);
          }
          state.set("step", (state.get("step") as number) + 1);
          return state;
        },
      },
    ];

    const analyzer = new Analyzer([]);
    const sim = new Simulation(
      initialState,
      properties,
      {},
      behaviors,
      [],
      analyzer,
    );

    let step = 0;
    for await (const { state } of runner(sim)) {
      step += 1;
      if (step > 4) {
        break;
      }
    }
  });
});
