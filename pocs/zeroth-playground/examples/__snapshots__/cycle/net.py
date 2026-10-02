from zrth import LIA, Bool, Int, Var
from zrth import Module as compose
from zrth.sugar import Module, X, ite

INT = Int([1, 1])
BOOL = Bool([1, 1])

A = Var(INT)
B = Var(INT)

fire_Go = Var(BOOL)  # Go fires this step
fire_Back = Var(BOOL)  # Back fires this step


class Transition_Go(Module):
    """Go: A -> B"""

    def init(self, A):
        return False

    def next(self, fire_Go, A):
        return A >= 1


class Transition_Back(Module):
    """Back: B -> A"""

    def init(self, B):
        return False

    def next(self, fire_Back, B):
        return B >= 1


class Place_A(Module):
    """A: taken by Go, added by Back"""

    def init(self, fire_Go, fire_Back):
        return 1

    def next(self, A, fire_Go, fire_Back):
        A = ite(X(fire_Go), A - 1, A)  # Go takes 1
        A = ite(X(fire_Back), A + 1, A)  # Back adds 1
        return A


class Place_B(Module):
    """B: taken by Back, added by Go"""

    def init(self, fire_Go, fire_Back):
        return 0

    def next(self, B, fire_Go, fire_Back):
        B = ite(X(fire_Go), B + 1, B)  # Go adds 1
        B = ite(X(fire_Back), B - 1, B)  # Back takes 1
        return B


transition_Go = Transition_Go(theory=LIA, ctrl=(fire_Go,), extl=(A,))
transition_Back = Transition_Back(theory=LIA, ctrl=(fire_Back,), extl=(B,))
place_A = Place_A(theory=LIA, ctrl=(A,), extl=(fire_Go, fire_Back))
place_B = Place_B(theory=LIA, ctrl=(B,), extl=(fire_Go, fire_Back))
net = compose(transition_Go, transition_Back, place_A, place_B)
