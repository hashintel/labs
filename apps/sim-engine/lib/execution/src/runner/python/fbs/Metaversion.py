# automatically generated by the FlatBuffers compiler, do not modify

# namespace: 

import flatbuffers
from flatbuffers.compat import import_numpy
np = import_numpy()

class Metaversion(object):
    __slots__ = ['_tab']

    @classmethod
    def GetRootAs(cls, buf, offset=0):
        n = flatbuffers.encode.Get(flatbuffers.packer.uoffset, buf, offset)
        x = Metaversion()
        x.Init(buf, n + offset)
        return x

    @classmethod
    def GetRootAsMetaversion(cls, buf, offset=0):
        """This method is deprecated. Please switch to GetRootAs."""
        return cls.GetRootAs(buf, offset)
    # Metaversion
    def Init(self, buf, pos):
        self._tab = flatbuffers.table.Table(buf, pos)

    # Metaversion
    def Memory(self):
        o = flatbuffers.number_types.UOffsetTFlags.py_type(self._tab.Offset(4))
        if o != 0:
            return self._tab.Get(flatbuffers.number_types.Uint32Flags, o + self._tab.Pos)
        return 0

    # Metaversion
    def Batch(self):
        o = flatbuffers.number_types.UOffsetTFlags.py_type(self._tab.Offset(6))
        if o != 0:
            return self._tab.Get(flatbuffers.number_types.Uint32Flags, o + self._tab.Pos)
        return 0

def Start(builder): builder.StartObject(2)
def MetaversionStart(builder):
    """This method is deprecated. Please switch to Start."""
    return Start(builder)
def AddMemory(builder, memory): builder.PrependUint32Slot(0, memory, 0)
def MetaversionAddMemory(builder, memory):
    """This method is deprecated. Please switch to AddMemory."""
    return AddMemory(builder, memory)
def AddBatch(builder, batch): builder.PrependUint32Slot(1, batch, 0)
def MetaversionAddBatch(builder, batch):
    """This method is deprecated. Please switch to AddBatch."""
    return AddBatch(builder, batch)
def End(builder): return builder.EndObject()
def MetaversionEnd(builder):
    """This method is deprecated. Please switch to End."""
    return End(builder)