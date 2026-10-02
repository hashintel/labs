from zrth import LRA, Bool, Real, Var
from zrth import Module as compose
from zrth.sugar import Module, X, ite

REAL = Real([1, 1])
BOOL = Bool([1, 1])

Waiting = Var(REAL)
FreeStaff = Var(REAL)
Serving = Var(REAL)
Served = Var(REAL)

u_Arrive = Var(REAL)  # uniform draw for Arrive, each step
u_BeginService = Var(REAL)  # uniform draw for BeginService, each step
u_FinishService = Var(REAL)  # uniform draw for FinishService, each step

fire_Arrive = Var(BOOL)  # Arrive fires this step
fire_BeginService = Var(BOOL)  # BeginService fires this step
fire_FinishService = Var(BOOL)  # FinishService fires this step


class Transition_Arrive(Module):
    """Arrive: nothing -> Waiting, at rate 1.2"""

    def init(self, u_Arrive):
        return False

    def next(self, fire_Arrive, u_Arrive):
        return X(u_Arrive) >= 0.3011942119122021


class Transition_BeginService(Module):
    """BeginService: Waiting, FreeStaff -> Serving, at rate 0.4"""

    def init(self, Waiting, FreeStaff, u_BeginService):
        return False

    def next(self, fire_BeginService, Waiting, FreeStaff, u_BeginService):
        return (Waiting >= 1.0) & (FreeStaff >= 1.0) & (X(u_BeginService) >= 0.6703200460356393)


class Transition_FinishService(Module):
    """FinishService: Serving -> Served, FreeStaff, at rate 0.5"""

    def init(self, Serving, u_FinishService):
        return False

    def next(self, fire_FinishService, Serving, u_FinishService):
        return (Serving >= 1.0) & (X(u_FinishService) >= 0.6065306597126334)


class Place_Waiting(Module):
    """Waiting: taken by BeginService, added by Arrive"""

    def init(self, fire_Arrive, fire_BeginService):
        return 3.0

    def next(self, Waiting, fire_Arrive, fire_BeginService):
        Waiting = ite(X(fire_Arrive), Waiting + 1.0, Waiting)  # Arrive adds 1
        Waiting = ite(X(fire_BeginService), Waiting - 1.0, Waiting)  # BeginService takes 1
        return Waiting


class Place_FreeStaff(Module):
    """FreeStaff: taken by BeginService, added by FinishService"""

    def init(self, fire_BeginService, fire_FinishService):
        return 2.0

    def next(self, FreeStaff, fire_BeginService, fire_FinishService):
        FreeStaff = ite(X(fire_BeginService), FreeStaff - 1.0, FreeStaff)  # BeginService takes 1
        FreeStaff = ite(X(fire_FinishService), FreeStaff + 1.0, FreeStaff)  # FinishService adds 1
        return FreeStaff


class Place_Serving(Module):
    """Serving: taken by FinishService, added by BeginService"""

    def init(self, fire_BeginService, fire_FinishService):
        return 0.0

    def next(self, Serving, fire_BeginService, fire_FinishService):
        Serving = ite(X(fire_BeginService), Serving + 1.0, Serving)  # BeginService adds 1
        Serving = ite(X(fire_FinishService), Serving - 1.0, Serving)  # FinishService takes 1
        return Serving


class Place_Served(Module):
    """Served: added by FinishService"""

    def init(self, fire_FinishService):
        return 0.0

    def next(self, Served, fire_FinishService):
        Served = ite(X(fire_FinishService), Served + 1.0, Served)  # FinishService adds 1
        return Served


transition_Arrive = Transition_Arrive(theory=LRA, ctrl=(fire_Arrive,), extl=(u_Arrive,))
transition_BeginService = Transition_BeginService(theory=LRA, ctrl=(fire_BeginService,), extl=(Waiting, FreeStaff, u_BeginService))
transition_FinishService = Transition_FinishService(theory=LRA, ctrl=(fire_FinishService,), extl=(Serving, u_FinishService))
place_Waiting = Place_Waiting(theory=LRA, ctrl=(Waiting,), extl=(fire_Arrive, fire_BeginService))
place_FreeStaff = Place_FreeStaff(theory=LRA, ctrl=(FreeStaff,), extl=(fire_BeginService, fire_FinishService))
place_Serving = Place_Serving(theory=LRA, ctrl=(Serving,), extl=(fire_BeginService, fire_FinishService))
place_Served = Place_Served(theory=LRA, ctrl=(Served,), extl=(fire_FinishService,))
net = compose(
    transition_Arrive,
    transition_BeginService,
    transition_FinishService,
    place_Waiting,
    place_FreeStaff,
    place_Serving,
    place_Served,
)
