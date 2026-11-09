import type { PetriNetIr } from "../ir/schema";
import type { CompilerOptions } from "../options";

/** The birth-death process of Zeroth's `birth_death.py`, as an IR. */
export const birthDeathIr: PetriNetIr = {
  name: "birth_death",
  kind: "stochastic",
  places: { Population: null },
  transitions: {
    Birth: { outputs: { Population: null }, rate: 2 },
    Death: { inputs: { Population: null }, rate: 1 },
  },
};

/** The options it is compiled under: clock rates. */
export const birthDeathOptions: CompilerOptions = { rates: "clock" };

/**
 * What the birth-death IR compiles to: the same atoms as `birth_death.py`
 * under zrth, up to variable and class names.
 */
export const birthDeathPython = `from zrth import SPN, Clock, Event, Nat, Var
from zrth import Module as compose
from zrth.sugar import Module, d, ite, fired, exp

t = Var(Clock())  # the time reference

Population = Var(Nat())

clk_Birth = Var(Clock())  # time left until Birth fires
clk_Death = Var(Clock())  # time left until Death fires

ev_Birth = Var(Event())  # toggles when Birth fires
ev_Death = Var(Event())  # toggles when Death fires


class Transition_Birth(Module):
    """Birth: nothing -> Population, at rate 2"""

    def init(self, t):
        return exp(2.0), False

    def next(self, clk_Birth, ev_Birth, t):
        fires_Birth = clk_Birth == 0
        return ite(fires_Birth, exp(2.0), clk_Birth), ite(fires_Birth, ~ev_Birth, None)

    def flow(self, clk_Birth, ev_Birth, t):
        return ite(clk_Birth >= 0, -1 * d(t), None), 0


class Transition_Death(Module):
    """Death: Population -> nothing, at rate 1"""

    def init(self, Population, t):
        return exp(1.0), False

    def next(self, clk_Death, ev_Death, Population, t):
        fires_Death = (clk_Death == 0) & (Population != 0)
        return ite(fires_Death, exp(1.0), clk_Death), ite(fires_Death, ~ev_Death, None)

    def flow(self, clk_Death, ev_Death, Population, t):
        return ite(clk_Death >= 0, ite(Population != 0, -1 * d(t), 0 * d(t)), None), 0


class Place_Population(Module):
    """Population: added by Birth, taken by Death"""

    def init(self, ev_Birth, ev_Death):
        return 0

    def next(self, Population, ev_Birth, ev_Death):
        fired_Birth = fired(ev_Birth)
        fired_Death = fired(ev_Death)
        return ite(fired_Birth & ~fired_Death, Population + 1, ite(fired_Death & ~fired_Birth & (Population != 0), Population - 1, Population))


transition_Birth = Transition_Birth(theory=SPN, ctrl=(clk_Birth, ev_Birth), extl=(t,))
transition_Death = Transition_Death(theory=SPN, ctrl=(clk_Death, ev_Death), extl=(Population, t))
place_Population = Place_Population(theory=SPN, ctrl=(Population,), extl=(ev_Birth, ev_Death))
net = compose(
    transition_Birth,
    transition_Death,
    place_Population,
    hide={clk_Birth, clk_Death},
)
`;
