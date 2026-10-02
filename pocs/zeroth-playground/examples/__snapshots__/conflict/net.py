from zrth import LIA, Bool, Int, Var
from zrth import Module as compose
from zrth.sugar import Module, X, ite

INT = Int([1, 1])
BOOL = Bool([1, 1])

Pool = Var(INT)
Left = Var(INT)
Right = Var(INT)

pick_TakeLeft = Var(BOOL)  # the environment lets TakeLeft fire this step
pick_TakeRight = Var(BOOL)  # the environment lets TakeRight fire this step

fire_TakeLeft = Var(BOOL)  # TakeLeft fires this step
fire_TakeRight = Var(BOOL)  # TakeRight fires this step
fire_Return = Var(BOOL)  # Return fires this step


class Transition_TakeLeft(Module):
    """TakeLeft: Pool -> Left"""

    def init(self, Pool, pick_TakeLeft):
        return False

    def next(self, fire_TakeLeft, Pool, pick_TakeLeft):
        return (Pool >= 1) & X(pick_TakeLeft)


class Transition_TakeRight(Module):
    """TakeRight: Pool -> Right"""

    def init(self, Pool, fire_TakeLeft, pick_TakeRight):
        return False

    def next(self, fire_TakeRight, Pool, fire_TakeLeft, pick_TakeRight):
        avail_Pool = Pool
        avail_Pool = ite(X(fire_TakeLeft), avail_Pool - 1, avail_Pool)  # TakeLeft took 1
        return (avail_Pool >= 1) & X(pick_TakeRight)


class Transition_Return(Module):
    """Return: Left -> Pool"""

    def init(self, Left):
        return False

    def next(self, fire_Return, Left):
        return Left >= 1


class Place_Pool(Module):
    """Pool: taken by TakeLeft, TakeRight, added by Return"""

    def init(self, fire_TakeLeft, fire_TakeRight, fire_Return):
        return 3

    def next(self, Pool, fire_TakeLeft, fire_TakeRight, fire_Return):
        Pool = ite(X(fire_TakeLeft), Pool - 1, Pool)  # TakeLeft takes 1
        Pool = ite(X(fire_TakeRight), Pool - 1, Pool)  # TakeRight takes 1
        Pool = ite(X(fire_Return), Pool + 1, Pool)  # Return adds 1
        return Pool


class Place_Left(Module):
    """Left: taken by Return, added by TakeLeft"""

    def init(self, fire_TakeLeft, fire_Return):
        return 0

    def next(self, Left, fire_TakeLeft, fire_Return):
        Left = ite(X(fire_TakeLeft), Left + 1, Left)  # TakeLeft adds 1
        Left = ite(X(fire_Return), Left - 1, Left)  # Return takes 1
        return Left


class Place_Right(Module):
    """Right: added by TakeRight"""

    def init(self, fire_TakeRight):
        return 0

    def next(self, Right, fire_TakeRight):
        Right = ite(X(fire_TakeRight), Right + 1, Right)  # TakeRight adds 1
        return Right


transition_TakeLeft = Transition_TakeLeft(theory=LIA, ctrl=(fire_TakeLeft,), extl=(Pool, pick_TakeLeft))
transition_TakeRight = Transition_TakeRight(theory=LIA, ctrl=(fire_TakeRight,), extl=(Pool, fire_TakeLeft, pick_TakeRight))
transition_Return = Transition_Return(theory=LIA, ctrl=(fire_Return,), extl=(Left,))
place_Pool = Place_Pool(theory=LIA, ctrl=(Pool,), extl=(fire_TakeLeft, fire_TakeRight, fire_Return))
place_Left = Place_Left(theory=LIA, ctrl=(Left,), extl=(fire_TakeLeft, fire_Return))
place_Right = Place_Right(theory=LIA, ctrl=(Right,), extl=(fire_TakeRight,))
net = compose(
    transition_TakeLeft,
    transition_TakeRight,
    transition_Return,
    place_Pool,
    place_Left,
    place_Right,
)
