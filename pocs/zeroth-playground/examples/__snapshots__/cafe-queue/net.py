from zrth import SPN, Clock, Event, Nat, Var
from zrth import Module as compose
from zrth.sugar import Module, d, ite, fired, exp

t = Var(Clock())  # the time reference

Waiting = Var(Nat())
FreeStaff = Var(Nat())
Serving = Var(Nat())

clk_BeginService = Var(Clock())  # time left until BeginService fires

ev_BeginService = Var(Event())  # toggles when BeginService fires


class Transition_BeginService(Module):
    """BeginService: Waiting, FreeStaff -> Serving, at rate 1"""

    def init(self, Waiting, FreeStaff, t):
        return exp(1.0), False

    def next(self, clk_BeginService, ev_BeginService, Waiting, FreeStaff, t):
        fires_BeginService = (clk_BeginService == 0) & (Waiting != 0) & (FreeStaff != 0)
        return ite(fires_BeginService, exp(1.0), clk_BeginService), ite(fires_BeginService, ~ev_BeginService, None)

    def flow(self, clk_BeginService, ev_BeginService, Waiting, FreeStaff, t):
        return ite(clk_BeginService >= 0, ite((Waiting != 0) & (FreeStaff != 0), -1 * d(t), 0 * d(t)), None), 0


class Place_Waiting(Module):
    """Waiting: taken by BeginService"""

    def init(self, ev_BeginService):
        return 1

    def next(self, Waiting, ev_BeginService):
        fired_BeginService = fired(ev_BeginService)
        return ite(fired_BeginService & (Waiting != 0), Waiting - 1, Waiting)


class Place_FreeStaff(Module):
    """FreeStaff: taken by BeginService"""

    def init(self, ev_BeginService):
        return 0

    def next(self, FreeStaff, ev_BeginService):
        fired_BeginService = fired(ev_BeginService)
        return ite(fired_BeginService & (FreeStaff != 0), FreeStaff - 1, FreeStaff)


class Place_Serving(Module):
    """Serving: added by BeginService"""

    def init(self, ev_BeginService):
        return 0

    def next(self, Serving, ev_BeginService):
        fired_BeginService = fired(ev_BeginService)
        return ite(fired_BeginService, Serving + 1, Serving)


transition_BeginService = Transition_BeginService(theory=SPN, ctrl=(clk_BeginService, ev_BeginService), extl=(Waiting, FreeStaff, t))
place_Waiting = Place_Waiting(theory=SPN, ctrl=(Waiting,), extl=(ev_BeginService,))
place_FreeStaff = Place_FreeStaff(theory=SPN, ctrl=(FreeStaff,), extl=(ev_BeginService,))
place_Serving = Place_Serving(theory=SPN, ctrl=(Serving,), extl=(ev_BeginService,))
net = compose(
    transition_BeginService,
    place_Waiting,
    place_FreeStaff,
    place_Serving,
    hide={clk_BeginService},
)
