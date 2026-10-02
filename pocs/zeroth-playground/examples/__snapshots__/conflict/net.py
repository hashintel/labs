from zrth import LIA, Bool, Int, Var
from zrth import Module as compose
from zrth.sugar import Module, X, ite

INT = Int([1, 1])
BOOL = Bool([1, 1])

Pool = Var(INT)
Left = Var(INT)
Right = Var(INT)

fire_TakeLeft = Var(BOOL)  # TakeLeft fires this step
fire_TakeRight = Var(BOOL)  # TakeRight fires this step


class Transition_TakeLeft(Module):
    """TakeLeft: 2 Pool -> Left"""

    def init(self, Pool):
        return False

    def next(self, fire_TakeLeft, Pool):
        return Pool >= 2


class Transition_TakeRight(Module):
    """TakeRight: Pool -> Right"""

    def init(self, Pool, fire_TakeLeft):
        return False

    def next(self, fire_TakeRight, Pool, fire_TakeLeft):
        avail_Pool = Pool
        avail_Pool = ite(X(fire_TakeLeft), avail_Pool - 2, avail_Pool)  # TakeLeft took 2
        return avail_Pool >= 1


class Place_Pool(Module):
    """Pool: taken by TakeLeft, TakeRight"""

    def init(self, fire_TakeLeft, fire_TakeRight):
        return 3

    def next(self, Pool, fire_TakeLeft, fire_TakeRight):
        Pool = ite(X(fire_TakeLeft), Pool - 2, Pool)  # TakeLeft takes 2
        Pool = ite(X(fire_TakeRight), Pool - 1, Pool)  # TakeRight takes 1
        return Pool


class Place_Left(Module):
    """Left: added by TakeLeft"""

    def init(self, fire_TakeLeft):
        return 0

    def next(self, Left, fire_TakeLeft):
        Left = ite(X(fire_TakeLeft), Left + 1, Left)  # TakeLeft adds 1
        return Left


class Place_Right(Module):
    """Right: added by TakeRight"""

    def init(self, fire_TakeRight):
        return 0

    def next(self, Right, fire_TakeRight):
        Right = ite(X(fire_TakeRight), Right + 1, Right)  # TakeRight adds 1
        return Right


transition_TakeLeft = Transition_TakeLeft(theory=LIA, ctrl=(fire_TakeLeft,), extl=(Pool,))
transition_TakeRight = Transition_TakeRight(theory=LIA, ctrl=(fire_TakeRight,), extl=(Pool, fire_TakeLeft))
place_Pool = Place_Pool(theory=LIA, ctrl=(Pool,), extl=(fire_TakeLeft, fire_TakeRight))
place_Left = Place_Left(theory=LIA, ctrl=(Left,), extl=(fire_TakeLeft,))
place_Right = Place_Right(theory=LIA, ctrl=(Right,), extl=(fire_TakeRight,))
net = compose(
    transition_TakeLeft,
    transition_TakeRight,
    place_Pool,
    place_Left,
    place_Right,
)
