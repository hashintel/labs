from zrth import LRA, Bool, Real, Var
from zrth import Module as compose
from zrth.sugar import Module, X, ite

REAL = Real([1, 1])
BOOL = Bool([1, 1])

Susceptible = Var(REAL)
Infected = Var(REAL)
Recovered = Var(REAL)

u_Infection = Var(REAL)  # uniform draw for Infection, each step
u_Recovery = Var(REAL)  # uniform draw for Recovery, each step

fire_Infection = Var(BOOL)  # Infection fires this step
fire_Recovery = Var(BOOL)  # Recovery fires this step


class Transition_Infection(Module):
    """Infection: Susceptible, Infected -> 2 Infected, at rate 3"""

    def init(self, Susceptible, Infected, u_Infection):
        return False

    def next(self, fire_Infection, Susceptible, Infected, u_Infection):
        return (Susceptible >= 1.0) & (Infected >= 1.0) & (X(u_Infection) >= 0.049787068367863944)


class Transition_Recovery(Module):
    """Recovery: Infected -> Recovered, at rate 1"""

    def init(self, Infected, fire_Infection, u_Recovery):
        return False

    def next(self, fire_Recovery, Infected, fire_Infection, u_Recovery):
        avail_Infected = Infected
        avail_Infected = ite(X(fire_Infection), avail_Infected - 1.0, avail_Infected)  # Infection took 1
        return (avail_Infected >= 1.0) & (X(u_Recovery) >= 0.36787944117144233)


class Place_Susceptible(Module):
    """Susceptible: taken by Infection"""

    def init(self, fire_Infection):
        return 9.0

    def next(self, Susceptible, fire_Infection):
        Susceptible = ite(X(fire_Infection), Susceptible - 1.0, Susceptible)  # Infection takes 1
        return Susceptible


class Place_Infected(Module):
    """Infected: taken by Recovery, added by Infection"""

    def init(self, fire_Infection, fire_Recovery):
        return 1.0

    def next(self, Infected, fire_Infection, fire_Recovery):
        Infected = ite(X(fire_Infection), Infected + 1.0, Infected)  # Infection adds 1
        Infected = ite(X(fire_Recovery), Infected - 1.0, Infected)  # Recovery takes 1
        return Infected


class Place_Recovered(Module):
    """Recovered: added by Recovery"""

    def init(self, fire_Recovery):
        return 0.0

    def next(self, Recovered, fire_Recovery):
        Recovered = ite(X(fire_Recovery), Recovered + 1.0, Recovered)  # Recovery adds 1
        return Recovered


transition_Infection = Transition_Infection(theory=LRA, ctrl=(fire_Infection,), extl=(Susceptible, Infected, u_Infection))
transition_Recovery = Transition_Recovery(theory=LRA, ctrl=(fire_Recovery,), extl=(Infected, fire_Infection, u_Recovery))
place_Susceptible = Place_Susceptible(theory=LRA, ctrl=(Susceptible,), extl=(fire_Infection,))
place_Infected = Place_Infected(theory=LRA, ctrl=(Infected,), extl=(fire_Infection, fire_Recovery))
place_Recovered = Place_Recovered(theory=LRA, ctrl=(Recovered,), extl=(fire_Recovery,))
net = compose(
    transition_Infection,
    transition_Recovery,
    place_Susceptible,
    place_Infected,
    place_Recovered,
)
