from zrth import LIA, Bool, Int, Var
from zrth import Module as compose
from zrth.sugar import Module, X, ite

INT = Int([1, 1])
BOOL = Bool([1, 1])

LeftSource = Var(INT)
RightSource = Var(INT)
Buffer = Var(INT)
Sink = Var(INT)

fire_PutLeft = Var(BOOL)  # PutLeft fires this step
fire_PutRight = Var(BOOL)  # PutRight fires this step
fire_Take = Var(BOOL)  # Take fires this step


class Transition_PutLeft(Module):
    """PutLeft: LeftSource -> Buffer"""

    def init(self, LeftSource, Buffer):
        return False

    def next(self, fire_PutLeft, LeftSource, Buffer):
        return (LeftSource >= 1) & (Buffer + 1 <= 2)


class Transition_PutRight(Module):
    """PutRight: RightSource -> Buffer"""

    def init(self, RightSource, Buffer, fire_PutLeft):
        return False

    def next(self, fire_PutRight, RightSource, Buffer, fire_PutLeft):
        fill_Buffer = Buffer
        fill_Buffer = ite(X(fire_PutLeft), fill_Buffer + 1, fill_Buffer)  # PutLeft added 1
        return (RightSource >= 1) & (fill_Buffer + 1 <= 2)


class Transition_Take(Module):
    """Take: Buffer -> Sink"""

    def init(self, Buffer):
        return False

    def next(self, fire_Take, Buffer):
        return Buffer >= 1


class Place_LeftSource(Module):
    """LeftSource: taken by PutLeft"""

    def init(self, fire_PutLeft):
        return 5

    def next(self, LeftSource, fire_PutLeft):
        LeftSource = ite(X(fire_PutLeft), LeftSource - 1, LeftSource)  # PutLeft takes 1
        return LeftSource


class Place_RightSource(Module):
    """RightSource: taken by PutRight"""

    def init(self, fire_PutRight):
        return 5

    def next(self, RightSource, fire_PutRight):
        RightSource = ite(X(fire_PutRight), RightSource - 1, RightSource)  # PutRight takes 1
        return RightSource


class Place_Buffer(Module):
    """Buffer: taken by Take, added by PutLeft, PutRight"""

    def init(self, fire_PutLeft, fire_PutRight, fire_Take):
        return 0

    def next(self, Buffer, fire_PutLeft, fire_PutRight, fire_Take):
        Buffer = ite(X(fire_PutLeft), Buffer + 1, Buffer)  # PutLeft adds 1
        Buffer = ite(X(fire_PutRight), Buffer + 1, Buffer)  # PutRight adds 1
        Buffer = ite(X(fire_Take), Buffer - 1, Buffer)  # Take takes 1
        return Buffer


class Place_Sink(Module):
    """Sink: added by Take"""

    def init(self, fire_Take):
        return 0

    def next(self, Sink, fire_Take):
        Sink = ite(X(fire_Take), Sink + 1, Sink)  # Take adds 1
        return Sink


transition_PutLeft = Transition_PutLeft(theory=LIA, ctrl=(fire_PutLeft,), extl=(LeftSource, Buffer))
transition_PutRight = Transition_PutRight(theory=LIA, ctrl=(fire_PutRight,), extl=(RightSource, Buffer, fire_PutLeft))
transition_Take = Transition_Take(theory=LIA, ctrl=(fire_Take,), extl=(Buffer,))
place_LeftSource = Place_LeftSource(theory=LIA, ctrl=(LeftSource,), extl=(fire_PutLeft,))
place_RightSource = Place_RightSource(theory=LIA, ctrl=(RightSource,), extl=(fire_PutRight,))
place_Buffer = Place_Buffer(theory=LIA, ctrl=(Buffer,), extl=(fire_PutLeft, fire_PutRight, fire_Take))
place_Sink = Place_Sink(theory=LIA, ctrl=(Sink,), extl=(fire_Take,))
net = compose(
    transition_PutLeft,
    transition_PutRight,
    transition_Take,
    place_LeftSource,
    place_RightSource,
    place_Buffer,
    place_Sink,
)
