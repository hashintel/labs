from zrth import LIA, Int, Var
from zrth.sugar import Module, ite

INT = Int([1, 1])

A = Var(INT)
B = Var(INT)


class Cycle(Module):
    """Plain Petri net with 2 places and 2 transitions. One next is one step of the net."""

    def init(self):
        return 1, 0

    def next(self, A, B):
        # sweep in order; a firing consumes its input tokens at once
        fire_Go = A >= 1  # Go: A -> B
        A = ite(fire_Go, A - 1, A)
        fire_Back = B >= 1  # Back: B -> A
        B = ite(fire_Back, B - 1, B)
        # end of step: produced tokens land
        A = ite(fire_Back, A + 1, A)
        B = ite(fire_Go, B + 1, B)
        return A, B


net = Cycle(theory=LIA, ctrl=(A, B))
