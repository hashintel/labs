from zrth import LRA, Bool, Real, Var
from zrth import Module as compose
from zrth.sugar import Module, X, ite

REAL = Real([1, 1])
BOOL = Bool([1, 1])

Population = Var(REAL)

u_Birth = Var(REAL)  # uniform draw for Birth, each step
u_Death = Var(REAL)  # uniform draw for Death, each step

fire_Birth = Var(BOOL)  # Birth fires this step
fire_Death = Var(BOOL)  # Death fires this step


class Transition_Birth(Module):
    """Birth: nothing -> Population, at rate 2"""

    def init(self, u_Birth):
        return False

    def next(self, fire_Birth, u_Birth):
        return X(u_Birth) >= 0.1353352832366127


class Transition_Death(Module):
    """Death: Population -> nothing, at rate 1"""

    def init(self, Population, u_Death):
        return False

    def next(self, fire_Death, Population, u_Death):
        return (Population >= 1.0) & (X(u_Death) >= 0.36787944117144233)


class Place_Population(Module):
    """Population: taken by Death, added by Birth"""

    def init(self, fire_Birth, fire_Death):
        return 0.0

    def next(self, Population, fire_Birth, fire_Death):
        Population = ite(X(fire_Birth), Population + 1.0, Population)  # Birth adds 1
        Population = ite(X(fire_Death), Population - 1.0, Population)  # Death takes 1
        return Population


transition_Birth = Transition_Birth(theory=LRA, ctrl=(fire_Birth,), extl=(u_Birth,))
transition_Death = Transition_Death(theory=LRA, ctrl=(fire_Death,), extl=(Population, u_Death))
place_Population = Place_Population(theory=LRA, ctrl=(Population,), extl=(fire_Birth, fire_Death))
net = compose(transition_Birth, transition_Death, place_Population)
