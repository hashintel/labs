from zrth import SPN, Bool, Clock, Event, Nat, Var
from zrth import Module as compose
from zrth.sugar import Module, d, ite, fired, exp

t = Var(Clock())  # the time reference

Pool = Var(Nat())
Left = Var(Nat())
Right = Var(Nat())

clk_TakeLeft = Var(Clock())  # time left until TakeLeft fires
clk_TakeRight = Var(Clock())  # time left until TakeRight fires
clk_Return = Var(Clock())  # time left until Return fires

ev_TakeLeft = Var(Event())  # toggles when TakeLeft fires
ev_TakeRight = Var(Event())  # toggles when TakeRight fires
ev_Return = Var(Event())  # toggles when Return fires

pick_TakeLeft = Var(Bool([1, 1]))  # the environment lets TakeLeft fire when its clock expires
pick_TakeRight = Var(Bool([1, 1]))  # the environment lets TakeRight fire when its clock expires


class Transition_TakeLeft(Module):
    """TakeLeft: Pool -> Left, at rate 1"""

    def init(self, Pool, pick_TakeLeft, t):
        return exp(1.0), False

    def next(self, clk_TakeLeft, ev_TakeLeft, Pool, pick_TakeLeft, t):
        fires_TakeLeft = (clk_TakeLeft == 0) & (Pool != 0) & pick_TakeLeft
        return ite(fires_TakeLeft, exp(1.0), clk_TakeLeft), ite(fires_TakeLeft, ~ev_TakeLeft, None)

    def flow(self, clk_TakeLeft, ev_TakeLeft, Pool, pick_TakeLeft, t):
        return ite(clk_TakeLeft >= 0, ite(Pool != 0, -1 * d(t), 0 * d(t)), None), 0


class Transition_TakeRight(Module):
    """TakeRight: Pool -> Right, at rate 2"""

    def init(self, Pool, pick_TakeRight, t):
        return exp(2.0), False

    def next(self, clk_TakeRight, ev_TakeRight, Pool, pick_TakeRight, t):
        fires_TakeRight = (clk_TakeRight == 0) & (Pool != 0) & pick_TakeRight
        return ite(fires_TakeRight, exp(2.0), clk_TakeRight), ite(fires_TakeRight, ~ev_TakeRight, None)

    def flow(self, clk_TakeRight, ev_TakeRight, Pool, pick_TakeRight, t):
        return ite(clk_TakeRight >= 0, ite(Pool != 0, -1 * d(t), 0 * d(t)), None), 0


class Transition_Return(Module):
    """Return: Left -> Pool, at rate 0.5"""

    def init(self, Left, t):
        return exp(0.5), False

    def next(self, clk_Return, ev_Return, Left, t):
        fires_Return = (clk_Return == 0) & (Left != 0)
        return ite(fires_Return, exp(0.5), clk_Return), ite(fires_Return, ~ev_Return, None)

    def flow(self, clk_Return, ev_Return, Left, t):
        return ite(clk_Return >= 0, ite(Left != 0, -1 * d(t), 0 * d(t)), None), 0


class Place_Pool(Module):
    """Pool: added by Return, taken by TakeLeft, TakeRight"""

    def init(self, ev_Return, ev_TakeLeft, ev_TakeRight):
        return 3

    def next(self, Pool, ev_Return, ev_TakeLeft, ev_TakeRight):
        fired_Return = fired(ev_Return)
        fired_TakeLeft = fired(ev_TakeLeft)
        fired_TakeRight = fired(ev_TakeRight)
        return ite(fired_Return & ~fired_TakeLeft & ~fired_TakeRight, Pool + 1, ite(fired_TakeLeft & ~fired_Return & ~fired_TakeRight & (Pool != 0), Pool - 1, ite(fired_TakeRight & ~fired_Return & ~fired_TakeLeft & (Pool != 0), Pool - 1, Pool)))


class Place_Left(Module):
    """Left: added by TakeLeft, taken by Return"""

    def init(self, ev_TakeLeft, ev_Return):
        return 0

    def next(self, Left, ev_TakeLeft, ev_Return):
        fired_TakeLeft = fired(ev_TakeLeft)
        fired_Return = fired(ev_Return)
        return ite(fired_TakeLeft & ~fired_Return, Left + 1, ite(fired_Return & ~fired_TakeLeft & (Left != 0), Left - 1, Left))


class Place_Right(Module):
    """Right: added by TakeRight"""

    def init(self, ev_TakeRight):
        return 0

    def next(self, Right, ev_TakeRight):
        fired_TakeRight = fired(ev_TakeRight)
        return ite(fired_TakeRight, Right + 1, Right)


transition_TakeLeft = Transition_TakeLeft(theory=SPN, ctrl=(clk_TakeLeft, ev_TakeLeft), extl=(Pool, pick_TakeLeft, t))
transition_TakeRight = Transition_TakeRight(theory=SPN, ctrl=(clk_TakeRight, ev_TakeRight), extl=(Pool, pick_TakeRight, t))
transition_Return = Transition_Return(theory=SPN, ctrl=(clk_Return, ev_Return), extl=(Left, t))
place_Pool = Place_Pool(theory=SPN, ctrl=(Pool,), extl=(ev_Return, ev_TakeLeft, ev_TakeRight))
place_Left = Place_Left(theory=SPN, ctrl=(Left,), extl=(ev_TakeLeft, ev_Return))
place_Right = Place_Right(theory=SPN, ctrl=(Right,), extl=(ev_TakeRight,))
net = compose(
    transition_TakeLeft,
    transition_TakeRight,
    transition_Return,
    place_Pool,
    place_Left,
    place_Right,
    hide={clk_TakeLeft, clk_TakeRight, clk_Return},
)
