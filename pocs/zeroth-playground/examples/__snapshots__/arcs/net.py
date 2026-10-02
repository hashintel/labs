from zrth import LIA, Bool, Int, Var
from zrth import Module as compose
from zrth.sugar import Module, X, ite

INT = Int([1, 1])
BOOL = Bool([1, 1])

Parts = Var(INT)
Power = Var(INT)
Jam = Var(INT)
Products = Var(INT)

fire_Join = Var(BOOL)  # Join fires this step


class Transition_Join(Module):
    """Join: 2 Parts, read Power, inhibitor Jam -> Products"""

    def init(self, Parts, Power, Jam):
        return False

    def next(self, fire_Join, Parts, Power, Jam):
        return (Parts >= 2) & (Power >= 1) & (Jam < 1)


class Place_Parts(Module):
    """Parts: taken by Join"""

    def init(self, fire_Join):
        return 5

    def next(self, Parts, fire_Join):
        Parts = ite(X(fire_Join), Parts - 2, Parts)  # Join takes 2
        return Parts


class Place_Power(Module):
    """Power: no transition moves its tokens"""

    def init(self):
        return 1

    def next(self, Power):
        return Power


class Place_Jam(Module):
    """Jam: no transition moves its tokens"""

    def init(self):
        return 0

    def next(self, Jam):
        return Jam


class Place_Products(Module):
    """Products: added by Join"""

    def init(self, fire_Join):
        return 0

    def next(self, Products, fire_Join):
        Products = ite(X(fire_Join), Products + 1, Products)  # Join adds 1
        return Products


transition_Join = Transition_Join(theory=LIA, ctrl=(fire_Join,), extl=(Parts, Power, Jam))
place_Parts = Place_Parts(theory=LIA, ctrl=(Parts,), extl=(fire_Join,))
place_Power = Place_Power(theory=LIA, ctrl=(Power,))
place_Jam = Place_Jam(theory=LIA, ctrl=(Jam,))
place_Products = Place_Products(theory=LIA, ctrl=(Products,), extl=(fire_Join,))
net = compose(transition_Join, place_Parts, place_Power, place_Jam, place_Products)
