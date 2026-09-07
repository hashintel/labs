//! Buffers a source's stream events until the batch is materialized. Each event
//! gets a sequence number for reading and trimming the batch. The source cursor
//! is persisted separately and determines which events to deliver after restart.
//! A failed batch is rolled back and negatively acknowledged for redelivery.

use std::collections::HashMap;

use crate::connectors::StreamEvent;

#[derive(Default)]
pub struct EventStore {
    sources: HashMap<String, SourceLog>,
}

#[derive(Default)]
struct SourceLog {
    seq: u64,
    events: Vec<(u64, StreamEvent)>,
}

impl EventStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends one source-delivered batch and returns the sequence before it.
    /// A negative acknowledgement truncates back to this point so a source
    /// redelivery does not duplicate buffered events.
    pub fn append(&mut self, source: &str, events: Vec<StreamEvent>) -> u64 {
        let log = self.sources.entry(source.to_owned()).or_default();
        let start = log.seq;
        for event in events {
            log.events.push((log.seq, event));
            log.seq += 1;
        }
        start
    }

    /// Events at or after `from_seq`, plus the next sequence.
    pub fn read(&self, source: &str, from_seq: u64) -> (Vec<StreamEvent>, u64) {
        match self.sources.get(source) {
            None => (vec![], 0),
            Some(log) => (
                log.events
                    .iter()
                    .filter(|(seq, _)| *seq >= from_seq)
                    .map(|(_, event)| event.clone())
                    .collect(),
                log.seq,
            ),
        }
    }

    pub fn trim(&mut self, source: &str, before_seq: u64) {
        if let Some(log) = self.sources.get_mut(source) {
            log.events.retain(|(seq, _)| *seq >= before_seq);
        }
    }

    pub fn rollback(&mut self, source: &str, start_seq: u64) {
        if let Some(log) = self.sources.get_mut(source) {
            log.events.retain(|(seq, _)| *seq < start_seq);
            log.seq = start_seq;
        }
    }
}
