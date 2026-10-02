from zrth import LRA, Bool, Real, Var
from zrth import Module as compose
from zrth.sugar import Module, X, ite

REAL = Real([1, 1])
BOOL = Bool([1, 1])

Waiting = Var(REAL)
Served = Var(REAL)

u_Arrive = Var(REAL)  # uniform draw for Arrive, each step
u_Serve = Var(REAL)  # uniform draw for Serve, each step

fire_Arrive = Var(BOOL)  # Arrive fires this step
fire_Serve = Var(BOOL)  # Serve fires this step


class Transition_Arrive(Module):
    """Arrive: nothing -> Waiting, at rate 2.5"""

    def init(self, Waiting, u_Arrive):
        return False

    def next(self, fire_Arrive, Waiting, u_Arrive):
        return (Waiting + 1.0 <= 4.0) & (X(u_Arrive) >= 0.2865047968601901)


class Transition_Serve(Module):
    """Serve: Waiting -> Served, at rate 3"""

    def init(self, Waiting, u_Serve):
        return False

    def next(self, fire_Serve, Waiting, u_Serve):
        return (Waiting >= 1.0) & (X(u_Serve) >= 0.22313016014842982)


class Place_Waiting(Module):
    """Waiting: taken by Serve, added by Arrive"""

    def init(self, fire_Arrive, fire_Serve):
        return 0.0

    def next(self, Waiting, fire_Arrive, fire_Serve):
        Waiting = ite(X(fire_Arrive), Waiting + 1.0, Waiting)  # Arrive adds 1
        Waiting = ite(X(fire_Serve), Waiting - 1.0, Waiting)  # Serve takes 1
        return Waiting


class Place_Served(Module):
    """Served: added by Serve"""

    def init(self, fire_Serve):
        return 0.0

    def next(self, Served, fire_Serve):
        Served = ite(X(fire_Serve), Served + 1.0, Served)  # Serve adds 1
        return Served


transition_Arrive = Transition_Arrive(theory=LRA, ctrl=(fire_Arrive,), extl=(Waiting, u_Arrive))
transition_Serve = Transition_Serve(theory=LRA, ctrl=(fire_Serve,), extl=(Waiting, u_Serve))
place_Waiting = Place_Waiting(theory=LRA, ctrl=(Waiting,), extl=(fire_Arrive, fire_Serve))
place_Served = Place_Served(theory=LRA, ctrl=(Served,), extl=(fire_Serve,))
net = compose(transition_Arrive, transition_Serve, place_Waiting, place_Served)
