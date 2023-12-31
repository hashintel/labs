# automatically generated by the FlatBuffers compiler, do not modify

# namespace: 

import flatbuffers
from flatbuffers.compat import import_numpy
np = import_numpy()

class RunnerWarning(object):
    __slots__ = ['_tab']

    @classmethod
    def GetRootAs(cls, buf, offset=0):
        n = flatbuffers.encode.Get(flatbuffers.packer.uoffset, buf, offset)
        x = RunnerWarning()
        x.Init(buf, n + offset)
        return x

    @classmethod
    def GetRootAsRunnerWarning(cls, buf, offset=0):
        """This method is deprecated. Please switch to GetRootAs."""
        return cls.GetRootAs(buf, offset)
    # RunnerWarning
    def Init(self, buf, pos):
        self._tab = flatbuffers.table.Table(buf, pos)

    # RunnerWarning
    def Msg(self):
        o = flatbuffers.number_types.UOffsetTFlags.py_type(self._tab.Offset(4))
        if o != 0:
            return self._tab.String(o + self._tab.Pos)
        return None

    # RunnerWarning
    def Details(self):
        o = flatbuffers.number_types.UOffsetTFlags.py_type(self._tab.Offset(6))
        if o != 0:
            return self._tab.String(o + self._tab.Pos)
        return None

def Start(builder): builder.StartObject(2)
def RunnerWarningStart(builder):
    """This method is deprecated. Please switch to Start."""
    return Start(builder)
def AddMsg(builder, msg): builder.PrependUOffsetTRelativeSlot(0, flatbuffers.number_types.UOffsetTFlags.py_type(msg), 0)
def RunnerWarningAddMsg(builder, msg):
    """This method is deprecated. Please switch to AddMsg."""
    return AddMsg(builder, msg)
def AddDetails(builder, details): builder.PrependUOffsetTRelativeSlot(1, flatbuffers.number_types.UOffsetTFlags.py_type(details), 0)
def RunnerWarningAddDetails(builder, details):
    """This method is deprecated. Please switch to AddDetails."""
    return AddDetails(builder, details)
def End(builder): return builder.EndObject()
def RunnerWarningEnd(builder):
    """This method is deprecated. Please switch to End."""
    return End(builder)