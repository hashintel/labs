from zrth import SPN, Clock, Event, Nat, Var
from zrth import Module as compose
from zrth.sugar import Module, d, ite, fired, exp

t = Var(Clock())  # the time reference

Waiting = Var(Nat())
FreeStaff = Var(Nat())
Serving = Var(Nat())
Served = Var(Nat())

clk_Arrive = Var(Clock())  # time left until Arrive fires
clk_BeginService = Var(Clock())  # time left until BeginService fires
clk_FinishService = Var(Clock())  # time left until FinishService fires

ev_Arrive = Var(Event())  # toggles when Arrive fires
ev_BeginService = Var(Event())  # toggles when BeginService fires
ev_FinishService = Var(Event())  # toggles when FinishService fires


class Transition_Arrive(Module):
    """Arrive: nothing -> Waiting, at rate 1.2"""

    def init(self, t):
        return exp(1.2), False

    def next(self, clk_Arrive, ev_Arrive, t):
        fires_Arrive = clk_Arrive == 0
        return ite(fires_Arrive, exp(1.2), clk_Arrive), ite(fires_Arrive, ~ev_Arrive, None)

    def flow(self, clk_Arrive, ev_Arrive, t):
        return ite(clk_Arrive >= 0, -1 * d(t), None), 0


class Transition_BeginService(Module):
    """BeginService: Waiting, FreeStaff -> Serving, at rate 0.4"""

    def init(self, Waiting, FreeStaff, t):
        return exp(0.4), False

    def next(self, clk_BeginService, ev_BeginService, Waiting, FreeStaff, t):
        fires_BeginService = (clk_BeginService == 0) & (Waiting != 0) & (FreeStaff != 0)
        return ite(fires_BeginService, exp(0.4), clk_BeginService), ite(fires_BeginService, ~ev_BeginService, None)

    def flow(self, clk_BeginService, ev_BeginService, Waiting, FreeStaff, t):
        return ite(clk_BeginService >= 0, ite((Waiting != 0) & (FreeStaff != 0), -1 * d(t), 0 * d(t)), None), 0


class Transition_FinishService(Module):
    """FinishService: Serving -> Served, FreeStaff, at rate 0.5"""

    def init(self, Serving, t):
        return exp(0.5), False

    def next(self, clk_FinishService, ev_FinishService, Serving, t):
        fires_FinishService = (clk_FinishService == 0) & (Serving != 0)
        return ite(fires_FinishService, exp(0.5), clk_FinishService), ite(fires_FinishService, ~ev_FinishService, None)

    def flow(self, clk_FinishService, ev_FinishService, Serving, t):
        return ite(clk_FinishService >= 0, ite(Serving != 0, -1 * d(t), 0 * d(t)), None), 0


class Place_Waiting(Module):
    """Waiting: added by Arrive, taken by BeginService"""

    def init(self, ev_Arrive, ev_BeginService):
        return 3

    def next(self, Waiting, ev_Arrive, ev_BeginService):
        fired_Arrive = fired(ev_Arrive)
        fired_BeginService = fired(ev_BeginService)
        return ite(fired_Arrive & ~fired_BeginService, Waiting + 1, ite(fired_BeginService & ~fired_Arrive & (Waiting != 0), Waiting - 1, Waiting))


class Place_FreeStaff(Module):
    """FreeStaff: added by FinishService, taken by BeginService"""

    def init(self, ev_FinishService, ev_BeginService):
        return 2

    def next(self, FreeStaff, ev_FinishService, ev_BeginService):
        fired_FinishService = fired(ev_FinishService)
        fired_BeginService = fired(ev_BeginService)
        return ite(fired_FinishService & ~fired_BeginService, FreeStaff + 1, ite(fired_BeginService & ~fired_FinishService & (FreeStaff != 0), FreeStaff - 1, FreeStaff))


class Place_Serving(Module):
    """Serving: added by BeginService, taken by FinishService"""

    def init(self, ev_BeginService, ev_FinishService):
        return 0

    def next(self, Serving, ev_BeginService, ev_FinishService):
        fired_BeginService = fired(ev_BeginService)
        fired_FinishService = fired(ev_FinishService)
        return ite(fired_BeginService & ~fired_FinishService, Serving + 1, ite(fired_FinishService & ~fired_BeginService & (Serving != 0), Serving - 1, Serving))


class Place_Served(Module):
    """Served: added by FinishService"""

    def init(self, ev_FinishService):
        return 0

    def next(self, Served, ev_FinishService):
        fired_FinishService = fired(ev_FinishService)
        return ite(fired_FinishService, Served + 1, Served)


transition_Arrive = Transition_Arrive(theory=SPN, ctrl=(clk_Arrive, ev_Arrive), extl=(t,))
transition_BeginService = Transition_BeginService(theory=SPN, ctrl=(clk_BeginService, ev_BeginService), extl=(Waiting, FreeStaff, t))
transition_FinishService = Transition_FinishService(theory=SPN, ctrl=(clk_FinishService, ev_FinishService), extl=(Serving, t))
place_Waiting = Place_Waiting(theory=SPN, ctrl=(Waiting,), extl=(ev_Arrive, ev_BeginService))
place_FreeStaff = Place_FreeStaff(theory=SPN, ctrl=(FreeStaff,), extl=(ev_FinishService, ev_BeginService))
place_Serving = Place_Serving(theory=SPN, ctrl=(Serving,), extl=(ev_BeginService, ev_FinishService))
place_Served = Place_Served(theory=SPN, ctrl=(Served,), extl=(ev_FinishService,))
net = compose(
    transition_Arrive,
    transition_BeginService,
    transition_FinishService,
    place_Waiting,
    place_FreeStaff,
    place_Serving,
    place_Served,
    hide={clk_Arrive, clk_BeginService, clk_FinishService},
)
