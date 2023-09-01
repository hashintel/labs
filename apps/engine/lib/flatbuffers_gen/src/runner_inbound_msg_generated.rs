#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::cast_sign_loss,
    clippy::empty_enum,
    clippy::used_underscore_binding,
    clippy::redundant_static_lifetimes,
    clippy::redundant_field_names,
    unused_imports
)]
// automatically generated by the FlatBuffers compiler, do not modify

use std::{cmp::Ordering, mem};

use super::{
    batch_generated::*, metaversion_generated::*, new_simulation_run_generated::*,
    package_config_generated::*, serialized_generated::*, shared_context_generated::*,
    sync_context_batch_generated::*, sync_state_generated::*, sync_state_interim_generated::*,
    sync_state_snapshot_generated::*, target_generated::*, task_msg_generated::*,
};

extern crate flatbuffers;
use self::flatbuffers::{EndianScalar, Follow};

#[deprecated(
    since = "2.0.0",
    note = "Use associated constants instead. This will no longer be generated in 2021."
)]
pub const ENUM_MIN_RUNNER_INBOUND_MSG_PAYLOAD: u8 = 0;
#[deprecated(
    since = "2.0.0",
    note = "Use associated constants instead. This will no longer be generated in 2021."
)]
pub const ENUM_MAX_RUNNER_INBOUND_MSG_PAYLOAD: u8 = 9;
#[deprecated(
    since = "2.0.0",
    note = "Use associated constants instead. This will no longer be generated in 2021."
)]
#[allow(non_camel_case_types)]
pub const ENUM_VALUES_RUNNER_INBOUND_MSG_PAYLOAD: [RunnerInboundMsgPayload; 10] = [
    RunnerInboundMsgPayload::NONE,
    RunnerInboundMsgPayload::TaskMsg,
    RunnerInboundMsgPayload::CancelTask,
    RunnerInboundMsgPayload::StateSync,
    RunnerInboundMsgPayload::StateSnapshotSync,
    RunnerInboundMsgPayload::ContextBatchSync,
    RunnerInboundMsgPayload::StateInterimSync,
    RunnerInboundMsgPayload::TerminateSimulationRun,
    RunnerInboundMsgPayload::TerminateRunner,
    RunnerInboundMsgPayload::NewSimulationRun,
];

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
#[repr(transparent)]
pub struct RunnerInboundMsgPayload(pub u8);
#[allow(non_upper_case_globals)]
impl RunnerInboundMsgPayload {
    pub const CancelTask: Self = Self(2);
    pub const ContextBatchSync: Self = Self(5);
    pub const ENUM_MAX: u8 = 9;
    pub const ENUM_MIN: u8 = 0;
    pub const ENUM_VALUES: &'static [Self] = &[
        Self::NONE,
        Self::TaskMsg,
        Self::CancelTask,
        Self::StateSync,
        Self::StateSnapshotSync,
        Self::ContextBatchSync,
        Self::StateInterimSync,
        Self::TerminateSimulationRun,
        Self::TerminateRunner,
        Self::NewSimulationRun,
    ];
    pub const NONE: Self = Self(0);
    pub const NewSimulationRun: Self = Self(9);
    pub const StateInterimSync: Self = Self(6);
    pub const StateSnapshotSync: Self = Self(4);
    pub const StateSync: Self = Self(3);
    pub const TaskMsg: Self = Self(1);
    pub const TerminateRunner: Self = Self(8);
    pub const TerminateSimulationRun: Self = Self(7);

    /// Returns the variant's name or "" if unknown.
    pub fn variant_name(self) -> Option<&'static str> {
        match self {
            Self::NONE => Some("NONE"),
            Self::TaskMsg => Some("TaskMsg"),
            Self::CancelTask => Some("CancelTask"),
            Self::StateSync => Some("StateSync"),
            Self::StateSnapshotSync => Some("StateSnapshotSync"),
            Self::ContextBatchSync => Some("ContextBatchSync"),
            Self::StateInterimSync => Some("StateInterimSync"),
            Self::TerminateSimulationRun => Some("TerminateSimulationRun"),
            Self::TerminateRunner => Some("TerminateRunner"),
            Self::NewSimulationRun => Some("NewSimulationRun"),
            _ => None,
        }
    }
}
impl std::fmt::Debug for RunnerInboundMsgPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        if let Some(name) = self.variant_name() {
            f.write_str(name)
        } else {
            f.write_fmt(format_args!("<UNKNOWN {:?}>", self.0))
        }
    }
}
impl<'a> flatbuffers::Follow<'a> for RunnerInboundMsgPayload {
    type Inner = Self;

    #[inline]
    fn follow(buf: &'a [u8], loc: usize) -> Self::Inner {
        let b = unsafe { flatbuffers::read_scalar_at::<u8>(buf, loc) };
        Self(b)
    }
}

impl flatbuffers::Push for RunnerInboundMsgPayload {
    type Output = RunnerInboundMsgPayload;

    #[inline]
    fn push(&self, dst: &mut [u8], _rest: &[u8]) {
        unsafe {
            flatbuffers::emplace_scalar::<u8>(dst, self.0);
        }
    }
}

impl flatbuffers::EndianScalar for RunnerInboundMsgPayload {
    #[inline]
    fn to_little_endian(self) -> Self {
        let b = u8::to_le(self.0);
        Self(b)
    }

    #[inline]
    #[allow(clippy::wrong_self_convention)]
    fn from_little_endian(self) -> Self {
        let b = u8::from_le(self.0);
        Self(b)
    }
}

impl<'a> flatbuffers::Verifiable for RunnerInboundMsgPayload {
    #[inline]
    fn run_verifier(
        v: &mut flatbuffers::Verifier,
        pos: usize,
    ) -> Result<(), flatbuffers::InvalidFlatbuffer> {
        use self::flatbuffers::Verifiable;
        u8::run_verifier(v, pos)
    }
}

impl flatbuffers::SimpleToVerifyInSlice for RunnerInboundMsgPayload {}
pub struct RunnerInboundMsgPayloadUnionTableOffset {}

pub enum CancelTaskOffset {}
#[derive(Copy, Clone, PartialEq)]

pub struct CancelTask<'a> {
    pub _tab: flatbuffers::Table<'a>,
}

impl<'a> flatbuffers::Follow<'a> for CancelTask<'a> {
    type Inner = CancelTask<'a>;

    #[inline]
    fn follow(buf: &'a [u8], loc: usize) -> Self::Inner {
        Self {
            _tab: flatbuffers::Table { buf, loc },
        }
    }
}

impl<'a> CancelTask<'a> {
    pub const VT_TASK_ID: flatbuffers::VOffsetT = 4;

    #[inline]
    pub fn init_from_table(table: flatbuffers::Table<'a>) -> Self {
        CancelTask { _tab: table }
    }

    #[allow(unused_mut)]
    pub fn create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr>(
        _fbb: &'mut_bldr mut flatbuffers::FlatBufferBuilder<'bldr>,
        args: &'args CancelTaskArgs<'args>,
    ) -> flatbuffers::WIPOffset<CancelTask<'bldr>> {
        let mut builder = CancelTaskBuilder::new(_fbb);
        if let Some(x) = args.task_id {
            builder.add_task_id(x);
        }
        builder.finish()
    }

    #[inline]
    pub fn task_id(&self) -> Option<&'a TaskId> {
        self._tab.get::<TaskId>(CancelTask::VT_TASK_ID, None)
    }
}

impl flatbuffers::Verifiable for CancelTask<'_> {
    #[inline]
    fn run_verifier(
        v: &mut flatbuffers::Verifier,
        pos: usize,
    ) -> Result<(), flatbuffers::InvalidFlatbuffer> {
        use self::flatbuffers::Verifiable;
        v.visit_table(pos)?
            .visit_field::<TaskId>(&"task_id", Self::VT_TASK_ID, false)?
            .finish();
        Ok(())
    }
}
pub struct CancelTaskArgs<'a> {
    pub task_id: Option<&'a TaskId>,
}
impl<'a> Default for CancelTaskArgs<'a> {
    #[inline]
    fn default() -> Self {
        CancelTaskArgs { task_id: None }
    }
}
pub struct CancelTaskBuilder<'a: 'b, 'b> {
    fbb_: &'b mut flatbuffers::FlatBufferBuilder<'a>,
    start_: flatbuffers::WIPOffset<flatbuffers::TableUnfinishedWIPOffset>,
}
impl<'a: 'b, 'b> CancelTaskBuilder<'a, 'b> {
    #[inline]
    pub fn add_task_id(&mut self, task_id: &TaskId) {
        self.fbb_
            .push_slot_always::<&TaskId>(CancelTask::VT_TASK_ID, task_id);
    }

    #[inline]
    pub fn new(_fbb: &'b mut flatbuffers::FlatBufferBuilder<'a>) -> CancelTaskBuilder<'a, 'b> {
        let start = _fbb.start_table();
        CancelTaskBuilder {
            fbb_: _fbb,
            start_: start,
        }
    }

    #[inline]
    pub fn finish(self) -> flatbuffers::WIPOffset<CancelTask<'a>> {
        let o = self.fbb_.end_table(self.start_);
        flatbuffers::WIPOffset::new(o.value())
    }
}

impl std::fmt::Debug for CancelTask<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut ds = f.debug_struct("CancelTask");
        ds.field("task_id", &self.task_id());
        ds.finish()
    }
}
pub enum TerminateRunnerOffset {}
#[derive(Copy, Clone, PartialEq)]

pub struct TerminateRunner<'a> {
    pub _tab: flatbuffers::Table<'a>,
}

impl<'a> flatbuffers::Follow<'a> for TerminateRunner<'a> {
    type Inner = TerminateRunner<'a>;

    #[inline]
    fn follow(buf: &'a [u8], loc: usize) -> Self::Inner {
        Self {
            _tab: flatbuffers::Table { buf, loc },
        }
    }
}

impl<'a> TerminateRunner<'a> {
    #[inline]
    pub fn init_from_table(table: flatbuffers::Table<'a>) -> Self {
        TerminateRunner { _tab: table }
    }

    #[allow(unused_mut)]
    pub fn create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr>(
        _fbb: &'mut_bldr mut flatbuffers::FlatBufferBuilder<'bldr>,
        _args: &'args TerminateRunnerArgs,
    ) -> flatbuffers::WIPOffset<TerminateRunner<'bldr>> {
        let mut builder = TerminateRunnerBuilder::new(_fbb);
        builder.finish()
    }
}

impl flatbuffers::Verifiable for TerminateRunner<'_> {
    #[inline]
    fn run_verifier(
        v: &mut flatbuffers::Verifier,
        pos: usize,
    ) -> Result<(), flatbuffers::InvalidFlatbuffer> {
        use self::flatbuffers::Verifiable;
        v.visit_table(pos)?.finish();
        Ok(())
    }
}
pub struct TerminateRunnerArgs {}
impl<'a> Default for TerminateRunnerArgs {
    #[inline]
    fn default() -> Self {
        TerminateRunnerArgs {}
    }
}
pub struct TerminateRunnerBuilder<'a: 'b, 'b> {
    fbb_: &'b mut flatbuffers::FlatBufferBuilder<'a>,
    start_: flatbuffers::WIPOffset<flatbuffers::TableUnfinishedWIPOffset>,
}
impl<'a: 'b, 'b> TerminateRunnerBuilder<'a, 'b> {
    #[inline]
    pub fn new(_fbb: &'b mut flatbuffers::FlatBufferBuilder<'a>) -> TerminateRunnerBuilder<'a, 'b> {
        let start = _fbb.start_table();
        TerminateRunnerBuilder {
            fbb_: _fbb,
            start_: start,
        }
    }

    #[inline]
    pub fn finish(self) -> flatbuffers::WIPOffset<TerminateRunner<'a>> {
        let o = self.fbb_.end_table(self.start_);
        flatbuffers::WIPOffset::new(o.value())
    }
}

impl std::fmt::Debug for TerminateRunner<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut ds = f.debug_struct("TerminateRunner");
        ds.finish()
    }
}
pub enum TerminateSimulationRunOffset {}
#[derive(Copy, Clone, PartialEq)]

pub struct TerminateSimulationRun<'a> {
    pub _tab: flatbuffers::Table<'a>,
}

impl<'a> flatbuffers::Follow<'a> for TerminateSimulationRun<'a> {
    type Inner = TerminateSimulationRun<'a>;

    #[inline]
    fn follow(buf: &'a [u8], loc: usize) -> Self::Inner {
        Self {
            _tab: flatbuffers::Table { buf, loc },
        }
    }
}

impl<'a> TerminateSimulationRun<'a> {
    #[inline]
    pub fn init_from_table(table: flatbuffers::Table<'a>) -> Self {
        TerminateSimulationRun { _tab: table }
    }

    #[allow(unused_mut)]
    pub fn create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr>(
        _fbb: &'mut_bldr mut flatbuffers::FlatBufferBuilder<'bldr>,
        _args: &'args TerminateSimulationRunArgs,
    ) -> flatbuffers::WIPOffset<TerminateSimulationRun<'bldr>> {
        let mut builder = TerminateSimulationRunBuilder::new(_fbb);
        builder.finish()
    }
}

impl flatbuffers::Verifiable for TerminateSimulationRun<'_> {
    #[inline]
    fn run_verifier(
        v: &mut flatbuffers::Verifier,
        pos: usize,
    ) -> Result<(), flatbuffers::InvalidFlatbuffer> {
        use self::flatbuffers::Verifiable;
        v.visit_table(pos)?.finish();
        Ok(())
    }
}
pub struct TerminateSimulationRunArgs {}
impl<'a> Default for TerminateSimulationRunArgs {
    #[inline]
    fn default() -> Self {
        TerminateSimulationRunArgs {}
    }
}
pub struct TerminateSimulationRunBuilder<'a: 'b, 'b> {
    fbb_: &'b mut flatbuffers::FlatBufferBuilder<'a>,
    start_: flatbuffers::WIPOffset<flatbuffers::TableUnfinishedWIPOffset>,
}
impl<'a: 'b, 'b> TerminateSimulationRunBuilder<'a, 'b> {
    #[inline]
    pub fn new(
        _fbb: &'b mut flatbuffers::FlatBufferBuilder<'a>,
    ) -> TerminateSimulationRunBuilder<'a, 'b> {
        let start = _fbb.start_table();
        TerminateSimulationRunBuilder {
            fbb_: _fbb,
            start_: start,
        }
    }

    #[inline]
    pub fn finish(self) -> flatbuffers::WIPOffset<TerminateSimulationRun<'a>> {
        let o = self.fbb_.end_table(self.start_);
        flatbuffers::WIPOffset::new(o.value())
    }
}

impl std::fmt::Debug for TerminateSimulationRun<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut ds = f.debug_struct("TerminateSimulationRun");
        ds.finish()
    }
}
pub enum RunnerInboundMsgOffset {}
#[derive(Copy, Clone, PartialEq)]

pub struct RunnerInboundMsg<'a> {
    pub _tab: flatbuffers::Table<'a>,
}

impl<'a> flatbuffers::Follow<'a> for RunnerInboundMsg<'a> {
    type Inner = RunnerInboundMsg<'a>;

    #[inline]
    fn follow(buf: &'a [u8], loc: usize) -> Self::Inner {
        Self {
            _tab: flatbuffers::Table { buf, loc },
        }
    }
}

impl<'a> RunnerInboundMsg<'a> {
    pub const VT_PAYLOAD: flatbuffers::VOffsetT = 8;
    pub const VT_PAYLOAD_TYPE: flatbuffers::VOffsetT = 6;
    pub const VT_SIM_SID: flatbuffers::VOffsetT = 4;

    #[inline]
    pub fn init_from_table(table: flatbuffers::Table<'a>) -> Self {
        RunnerInboundMsg { _tab: table }
    }

    #[allow(unused_mut)]
    pub fn create<'bldr: 'args, 'args: 'mut_bldr, 'mut_bldr>(
        _fbb: &'mut_bldr mut flatbuffers::FlatBufferBuilder<'bldr>,
        args: &'args RunnerInboundMsgArgs,
    ) -> flatbuffers::WIPOffset<RunnerInboundMsg<'bldr>> {
        let mut builder = RunnerInboundMsgBuilder::new(_fbb);
        if let Some(x) = args.payload {
            builder.add_payload(x);
        }
        builder.add_sim_sid(args.sim_sid);
        builder.add_payload_type(args.payload_type);
        builder.finish()
    }

    #[inline]
    pub fn sim_sid(&self) -> u32 {
        self._tab
            .get::<u32>(RunnerInboundMsg::VT_SIM_SID, Some(0))
            .unwrap()
    }

    #[inline]
    pub fn payload_type(&self) -> RunnerInboundMsgPayload {
        self._tab
            .get::<RunnerInboundMsgPayload>(
                RunnerInboundMsg::VT_PAYLOAD_TYPE,
                Some(RunnerInboundMsgPayload::NONE),
            )
            .unwrap()
    }

    #[inline]
    pub fn payload(&self) -> flatbuffers::Table<'a> {
        self._tab
            .get::<flatbuffers::ForwardsUOffset<flatbuffers::Table<'a>>>(
                RunnerInboundMsg::VT_PAYLOAD,
                None,
            )
            .unwrap()
    }

    #[inline]
    #[allow(non_snake_case)]
    pub fn payload_as_task_msg(&self) -> Option<TaskMsg<'a>> {
        if self.payload_type() == RunnerInboundMsgPayload::TaskMsg {
            let u = self.payload();
            Some(TaskMsg::init_from_table(u))
        } else {
            None
        }
    }

    #[inline]
    #[allow(non_snake_case)]
    pub fn payload_as_cancel_task(&self) -> Option<CancelTask<'a>> {
        if self.payload_type() == RunnerInboundMsgPayload::CancelTask {
            let u = self.payload();
            Some(CancelTask::init_from_table(u))
        } else {
            None
        }
    }

    #[inline]
    #[allow(non_snake_case)]
    pub fn payload_as_state_sync(&self) -> Option<StateSync<'a>> {
        if self.payload_type() == RunnerInboundMsgPayload::StateSync {
            let u = self.payload();
            Some(StateSync::init_from_table(u))
        } else {
            None
        }
    }

    #[inline]
    #[allow(non_snake_case)]
    pub fn payload_as_state_snapshot_sync(&self) -> Option<StateSnapshotSync<'a>> {
        if self.payload_type() == RunnerInboundMsgPayload::StateSnapshotSync {
            let u = self.payload();
            Some(StateSnapshotSync::init_from_table(u))
        } else {
            None
        }
    }

    #[inline]
    #[allow(non_snake_case)]
    pub fn payload_as_context_batch_sync(&self) -> Option<ContextBatchSync<'a>> {
        if self.payload_type() == RunnerInboundMsgPayload::ContextBatchSync {
            let u = self.payload();
            Some(ContextBatchSync::init_from_table(u))
        } else {
            None
        }
    }

    #[inline]
    #[allow(non_snake_case)]
    pub fn payload_as_state_interim_sync(&self) -> Option<StateInterimSync<'a>> {
        if self.payload_type() == RunnerInboundMsgPayload::StateInterimSync {
            let u = self.payload();
            Some(StateInterimSync::init_from_table(u))
        } else {
            None
        }
    }

    #[inline]
    #[allow(non_snake_case)]
    pub fn payload_as_terminate_simulation_run(&self) -> Option<TerminateSimulationRun<'a>> {
        if self.payload_type() == RunnerInboundMsgPayload::TerminateSimulationRun {
            let u = self.payload();
            Some(TerminateSimulationRun::init_from_table(u))
        } else {
            None
        }
    }

    #[inline]
    #[allow(non_snake_case)]
    pub fn payload_as_terminate_runner(&self) -> Option<TerminateRunner<'a>> {
        if self.payload_type() == RunnerInboundMsgPayload::TerminateRunner {
            let u = self.payload();
            Some(TerminateRunner::init_from_table(u))
        } else {
            None
        }
    }

    #[inline]
    #[allow(non_snake_case)]
    pub fn payload_as_new_simulation_run(&self) -> Option<NewSimulationRun<'a>> {
        if self.payload_type() == RunnerInboundMsgPayload::NewSimulationRun {
            let u = self.payload();
            Some(NewSimulationRun::init_from_table(u))
        } else {
            None
        }
    }
}

impl flatbuffers::Verifiable for RunnerInboundMsg<'_> {
    #[inline]
    fn run_verifier(
        v: &mut flatbuffers::Verifier,
        pos: usize,
    ) -> Result<(), flatbuffers::InvalidFlatbuffer> {
        use self::flatbuffers::Verifiable;
        v.visit_table(pos)?
            .visit_field::<u32>(&"sim_sid", Self::VT_SIM_SID, false)?
            .visit_union::<RunnerInboundMsgPayload, _>(
                &"payload_type",
                Self::VT_PAYLOAD_TYPE,
                &"payload",
                Self::VT_PAYLOAD,
                true,
                |key, v, pos| match key {
                    RunnerInboundMsgPayload::TaskMsg => v
                        .verify_union_variant::<flatbuffers::ForwardsUOffset<TaskMsg>>(
                            "RunnerInboundMsgPayload::TaskMsg",
                            pos,
                        ),
                    RunnerInboundMsgPayload::CancelTask => v
                        .verify_union_variant::<flatbuffers::ForwardsUOffset<CancelTask>>(
                            "RunnerInboundMsgPayload::CancelTask",
                            pos,
                        ),
                    RunnerInboundMsgPayload::StateSync => v
                        .verify_union_variant::<flatbuffers::ForwardsUOffset<StateSync>>(
                            "RunnerInboundMsgPayload::StateSync",
                            pos,
                        ),
                    RunnerInboundMsgPayload::StateSnapshotSync => v
                        .verify_union_variant::<flatbuffers::ForwardsUOffset<StateSnapshotSync>>(
                            "RunnerInboundMsgPayload::StateSnapshotSync",
                            pos,
                        ),
                    RunnerInboundMsgPayload::ContextBatchSync => v
                        .verify_union_variant::<flatbuffers::ForwardsUOffset<ContextBatchSync>>(
                            "RunnerInboundMsgPayload::ContextBatchSync",
                            pos,
                        ),
                    RunnerInboundMsgPayload::StateInterimSync => v
                        .verify_union_variant::<flatbuffers::ForwardsUOffset<StateInterimSync>>(
                            "RunnerInboundMsgPayload::StateInterimSync",
                            pos,
                        ),
                    RunnerInboundMsgPayload::TerminateSimulationRun => v
                        .verify_union_variant::<flatbuffers::ForwardsUOffset<
                        TerminateSimulationRun,
                    >>(
                        "RunnerInboundMsgPayload::TerminateSimulationRun",
                        pos,
                    ),
                    RunnerInboundMsgPayload::TerminateRunner => v
                        .verify_union_variant::<flatbuffers::ForwardsUOffset<TerminateRunner>>(
                            "RunnerInboundMsgPayload::TerminateRunner",
                            pos,
                        ),
                    RunnerInboundMsgPayload::NewSimulationRun => v
                        .verify_union_variant::<flatbuffers::ForwardsUOffset<NewSimulationRun>>(
                            "RunnerInboundMsgPayload::NewSimulationRun",
                            pos,
                        ),
                    _ => Ok(()),
                },
            )?
            .finish();
        Ok(())
    }
}
pub struct RunnerInboundMsgArgs {
    pub sim_sid: u32,
    pub payload_type: RunnerInboundMsgPayload,
    pub payload: Option<flatbuffers::WIPOffset<flatbuffers::UnionWIPOffset>>,
}
impl<'a> Default for RunnerInboundMsgArgs {
    #[inline]
    fn default() -> Self {
        RunnerInboundMsgArgs {
            sim_sid: 0,
            payload_type: RunnerInboundMsgPayload::NONE,
            payload: None, // required field
        }
    }
}
pub struct RunnerInboundMsgBuilder<'a: 'b, 'b> {
    fbb_: &'b mut flatbuffers::FlatBufferBuilder<'a>,
    start_: flatbuffers::WIPOffset<flatbuffers::TableUnfinishedWIPOffset>,
}
impl<'a: 'b, 'b> RunnerInboundMsgBuilder<'a, 'b> {
    #[inline]
    pub fn add_sim_sid(&mut self, sim_sid: u32) {
        self.fbb_
            .push_slot::<u32>(RunnerInboundMsg::VT_SIM_SID, sim_sid, 0);
    }

    #[inline]
    pub fn add_payload_type(&mut self, payload_type: RunnerInboundMsgPayload) {
        self.fbb_.push_slot::<RunnerInboundMsgPayload>(
            RunnerInboundMsg::VT_PAYLOAD_TYPE,
            payload_type,
            RunnerInboundMsgPayload::NONE,
        );
    }

    #[inline]
    pub fn add_payload(&mut self, payload: flatbuffers::WIPOffset<flatbuffers::UnionWIPOffset>) {
        self.fbb_
            .push_slot_always::<flatbuffers::WIPOffset<_>>(RunnerInboundMsg::VT_PAYLOAD, payload);
    }

    #[inline]
    pub fn new(
        _fbb: &'b mut flatbuffers::FlatBufferBuilder<'a>,
    ) -> RunnerInboundMsgBuilder<'a, 'b> {
        let start = _fbb.start_table();
        RunnerInboundMsgBuilder {
            fbb_: _fbb,
            start_: start,
        }
    }

    #[inline]
    pub fn finish(self) -> flatbuffers::WIPOffset<RunnerInboundMsg<'a>> {
        let o = self.fbb_.end_table(self.start_);
        self.fbb_
            .required(o, RunnerInboundMsg::VT_PAYLOAD, "payload");
        flatbuffers::WIPOffset::new(o.value())
    }
}

impl std::fmt::Debug for RunnerInboundMsg<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut ds = f.debug_struct("RunnerInboundMsg");
        ds.field("sim_sid", &self.sim_sid());
        ds.field("payload_type", &self.payload_type());
        match self.payload_type() {
            RunnerInboundMsgPayload::TaskMsg => {
                if let Some(x) = self.payload_as_task_msg() {
                    ds.field("payload", &x)
                } else {
                    ds.field(
                        "payload",
                        &"InvalidFlatbuffer: Union discriminant does not match value.",
                    )
                }
            }
            RunnerInboundMsgPayload::CancelTask => {
                if let Some(x) = self.payload_as_cancel_task() {
                    ds.field("payload", &x)
                } else {
                    ds.field(
                        "payload",
                        &"InvalidFlatbuffer: Union discriminant does not match value.",
                    )
                }
            }
            RunnerInboundMsgPayload::StateSync => {
                if let Some(x) = self.payload_as_state_sync() {
                    ds.field("payload", &x)
                } else {
                    ds.field(
                        "payload",
                        &"InvalidFlatbuffer: Union discriminant does not match value.",
                    )
                }
            }
            RunnerInboundMsgPayload::StateSnapshotSync => {
                if let Some(x) = self.payload_as_state_snapshot_sync() {
                    ds.field("payload", &x)
                } else {
                    ds.field(
                        "payload",
                        &"InvalidFlatbuffer: Union discriminant does not match value.",
                    )
                }
            }
            RunnerInboundMsgPayload::ContextBatchSync => {
                if let Some(x) = self.payload_as_context_batch_sync() {
                    ds.field("payload", &x)
                } else {
                    ds.field(
                        "payload",
                        &"InvalidFlatbuffer: Union discriminant does not match value.",
                    )
                }
            }
            RunnerInboundMsgPayload::StateInterimSync => {
                if let Some(x) = self.payload_as_state_interim_sync() {
                    ds.field("payload", &x)
                } else {
                    ds.field(
                        "payload",
                        &"InvalidFlatbuffer: Union discriminant does not match value.",
                    )
                }
            }
            RunnerInboundMsgPayload::TerminateSimulationRun => {
                if let Some(x) = self.payload_as_terminate_simulation_run() {
                    ds.field("payload", &x)
                } else {
                    ds.field(
                        "payload",
                        &"InvalidFlatbuffer: Union discriminant does not match value.",
                    )
                }
            }
            RunnerInboundMsgPayload::TerminateRunner => {
                if let Some(x) = self.payload_as_terminate_runner() {
                    ds.field("payload", &x)
                } else {
                    ds.field(
                        "payload",
                        &"InvalidFlatbuffer: Union discriminant does not match value.",
                    )
                }
            }
            RunnerInboundMsgPayload::NewSimulationRun => {
                if let Some(x) = self.payload_as_new_simulation_run() {
                    ds.field("payload", &x)
                } else {
                    ds.field(
                        "payload",
                        &"InvalidFlatbuffer: Union discriminant does not match value.",
                    )
                }
            }
            _ => {
                let x: Option<()> = None;
                ds.field("payload", &x)
            }
        };
        ds.finish()
    }
}
#[inline]
#[deprecated(since = "2.0.0", note = "Deprecated in favor of `root_as...` methods.")]
pub fn get_root_as_runner_inbound_msg<'a>(buf: &'a [u8]) -> RunnerInboundMsg<'a> {
    unsafe { flatbuffers::root_unchecked::<RunnerInboundMsg<'a>>(buf) }
}

#[inline]
#[deprecated(since = "2.0.0", note = "Deprecated in favor of `root_as...` methods.")]
pub fn get_size_prefixed_root_as_runner_inbound_msg<'a>(buf: &'a [u8]) -> RunnerInboundMsg<'a> {
    unsafe { flatbuffers::size_prefixed_root_unchecked::<RunnerInboundMsg<'a>>(buf) }
}

#[inline]
/// Verifies that a buffer of bytes contains a `RunnerInboundMsg`
/// and returns it.
/// Note that verification is still experimental and may not
/// catch every error, or be maximally performant. For the
/// previous, unchecked, behavior use
/// `root_as_runner_inbound_msg_unchecked`.
pub fn root_as_runner_inbound_msg(
    buf: &[u8],
) -> Result<RunnerInboundMsg, flatbuffers::InvalidFlatbuffer> {
    flatbuffers::root::<RunnerInboundMsg>(buf)
}
#[inline]
/// Verifies that a buffer of bytes contains a size prefixed
/// `RunnerInboundMsg` and returns it.
/// Note that verification is still experimental and may not
/// catch every error, or be maximally performant. For the
/// previous, unchecked, behavior use
/// `size_prefixed_root_as_runner_inbound_msg_unchecked`.
pub fn size_prefixed_root_as_runner_inbound_msg(
    buf: &[u8],
) -> Result<RunnerInboundMsg, flatbuffers::InvalidFlatbuffer> {
    flatbuffers::size_prefixed_root::<RunnerInboundMsg>(buf)
}
#[inline]
/// Verifies, with the given options, that a buffer of bytes
/// contains a `RunnerInboundMsg` and returns it.
/// Note that verification is still experimental and may not
/// catch every error, or be maximally performant. For the
/// previous, unchecked, behavior use
/// `root_as_runner_inbound_msg_unchecked`.
pub fn root_as_runner_inbound_msg_with_opts<'b, 'o>(
    opts: &'o flatbuffers::VerifierOptions,
    buf: &'b [u8],
) -> Result<RunnerInboundMsg<'b>, flatbuffers::InvalidFlatbuffer> {
    flatbuffers::root_with_opts::<RunnerInboundMsg<'b>>(opts, buf)
}
#[inline]
/// Verifies, with the given verifier options, that a buffer of
/// bytes contains a size prefixed `RunnerInboundMsg` and returns
/// it. Note that verification is still experimental and may not
/// catch every error, or be maximally performant. For the
/// previous, unchecked, behavior use
/// `root_as_runner_inbound_msg_unchecked`.
pub fn size_prefixed_root_as_runner_inbound_msg_with_opts<'b, 'o>(
    opts: &'o flatbuffers::VerifierOptions,
    buf: &'b [u8],
) -> Result<RunnerInboundMsg<'b>, flatbuffers::InvalidFlatbuffer> {
    flatbuffers::size_prefixed_root_with_opts::<RunnerInboundMsg<'b>>(opts, buf)
}
#[inline]
/// Assumes, without verification, that a buffer of bytes contains a RunnerInboundMsg and returns
/// it. # Safety
/// Callers must trust the given bytes do indeed contain a valid `RunnerInboundMsg`.
pub unsafe fn root_as_runner_inbound_msg_unchecked(buf: &[u8]) -> RunnerInboundMsg {
    flatbuffers::root_unchecked::<RunnerInboundMsg>(buf)
}
#[inline]
/// Assumes, without verification, that a buffer of bytes contains a size prefixed RunnerInboundMsg
/// and returns it. # Safety
/// Callers must trust the given bytes do indeed contain a valid size prefixed `RunnerInboundMsg`.
pub unsafe fn size_prefixed_root_as_runner_inbound_msg_unchecked(buf: &[u8]) -> RunnerInboundMsg {
    flatbuffers::size_prefixed_root_unchecked::<RunnerInboundMsg>(buf)
}
#[inline]
pub fn finish_runner_inbound_msg_buffer<'a, 'b>(
    fbb: &'b mut flatbuffers::FlatBufferBuilder<'a>,
    root: flatbuffers::WIPOffset<RunnerInboundMsg<'a>>,
) {
    fbb.finish(root, None);
}

#[inline]
pub fn finish_size_prefixed_runner_inbound_msg_buffer<'a, 'b>(
    fbb: &'b mut flatbuffers::FlatBufferBuilder<'a>,
    root: flatbuffers::WIPOffset<RunnerInboundMsg<'a>>,
) {
    fbb.finish_size_prefixed(root, None);
}
