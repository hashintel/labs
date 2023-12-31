# automatically generated by the FlatBuffers compiler, do not modify

# namespace: 

import flatbuffers
from flatbuffers.compat import import_numpy
np = import_numpy()

class RunnerOutboundMsg(object):
    __slots__ = ['_tab']

    @classmethod
    def GetRootAs(cls, buf, offset=0):
        n = flatbuffers.encode.Get(flatbuffers.packer.uoffset, buf, offset)
        x = RunnerOutboundMsg()
        x.Init(buf, n + offset)
        return x

    @classmethod
    def GetRootAsRunnerOutboundMsg(cls, buf, offset=0):
        """This method is deprecated. Please switch to GetRootAs."""
        return cls.GetRootAs(buf, offset)
    # RunnerOutboundMsg
    def Init(self, buf, pos):
        self._tab = flatbuffers.table.Table(buf, pos)

    # RunnerOutboundMsg
    def SimSid(self):
        o = flatbuffers.number_types.UOffsetTFlags.py_type(self._tab.Offset(4))
        if o != 0:
            return self._tab.Get(flatbuffers.number_types.Uint32Flags, o + self._tab.Pos)
        return 0

    # RunnerOutboundMsg
    def PayloadType(self):
        o = flatbuffers.number_types.UOffsetTFlags.py_type(self._tab.Offset(6))
        if o != 0:
            return self._tab.Get(flatbuffers.number_types.Uint8Flags, o + self._tab.Pos)
        return 0

    # RunnerOutboundMsg
    def Payload(self):
        o = flatbuffers.number_types.UOffsetTFlags.py_type(self._tab.Offset(8))
        if o != 0:
            from flatbuffers.table import Table
            obj = Table(bytearray(), 0)
            self._tab.Union(obj, o)
            return obj
        return None

def Start(builder): builder.StartObject(3)
def RunnerOutboundMsgStart(builder):
    """This method is deprecated. Please switch to Start."""
    return Start(builder)
def AddSimSid(builder, simSid): builder.PrependUint32Slot(0, simSid, 0)
def RunnerOutboundMsgAddSimSid(builder, simSid):
    """This method is deprecated. Please switch to AddSimSid."""
    return AddSimSid(builder, simSid)
def AddPayloadType(builder, payloadType): builder.PrependUint8Slot(1, payloadType, 0)
def RunnerOutboundMsgAddPayloadType(builder, payloadType):
    """This method is deprecated. Please switch to AddPayloadType."""
    return AddPayloadType(builder, payloadType)
def AddPayload(builder, payload): builder.PrependUOffsetTRelativeSlot(2, flatbuffers.number_types.UOffsetTFlags.py_type(payload), 0)
def RunnerOutboundMsgAddPayload(builder, payload):
    """This method is deprecated. Please switch to AddPayload."""
    return AddPayload(builder, payload)
def End(builder): return builder.EndObject()
def RunnerOutboundMsgEnd(builder):
    """This method is deprecated. Please switch to End."""
    return End(builder)