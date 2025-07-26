import { AgentState, NamedBehavior } from "../glue";
import { Analyzer } from "./Analyzer";
import { Simulation } from "./Simulation";

async function* runner(sim: Simulation) {
  while (true) {
    yield await sim.next_state();
  }
}

test("should run", async () => {
  const initialState: AgentState[] = [
    {
      agent_id: "test",
      position: [0, 0, 0],
      behaviors: ["move"],
    },
  ];
  const properties = {};
  const behaviors: NamedBehavior[] = [
    {
      name: "move",
      dependencies: [],
      behavior: (state) => {
        state.modify("position", (pos) => {
          pos[0] += 1;
          return pos;
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
    behaviors,
    [],
    analyzer,
  );

  let i = 0;
  for await (const { state } of runner(sim)) {
    i += 1;
    if (i > 10) {
      break;
    }
    expect(state[0].agent_id).not.toBeNull();
    expect(state[0].position![0]).toEqual(i);
  }

  await sim.drop();
});

test("should not reuse a dropped Simulation", async () => {
  const sim = new Simulation([], {}, {}, [], [], new Analyzer([]));
  await sim.drop();

  await expect(sim.next_state()).rejects.toEqual(
    new Error("Cannot reuse a dropped Simulation"),
  );
});
