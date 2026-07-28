//! Decoder for the pgoutput logical-replication plugin, protocol version 1
//! (vendored: the wire format has been stable since PostgreSQL 10). Stateful
//! only in the relation registry: Relation messages describe columns, DML
//! messages reference them by relation id. Tuples arrive in text format;
//! values stay strings (the engine's event tables are VARCHAR-typed, matching
//! the TS event path). With REPLICA IDENTITY FULL, Update/Delete carry the
//! full old tuple ('O'), giving true before-images.
//!
//! The live replication connection (walsender START_REPLICATION) is deferred
//! in this engine; the decoder is the hermetically-tested core it will sit
//! on, and the Elixir engine remains the live-CDC reference.

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relation {
    pub id: u32,
    pub namespace: String,
    pub name: String,
    pub replica_identity: u8,
    pub columns: Vec<String>,
}

pub type Row = HashMap<String, Option<String>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    Begin {
        final_lsn: u64,
        commit_timestamp: u64,
        xid: u32,
    },
    Commit {
        commit_lsn: u64,
        end_lsn: u64,
    },
    Relation(Relation),
    Insert {
        relation_id: u32,
        new: Row,
    },
    Update {
        relation_id: u32,
        old: Option<Row>,
        new: Row,
    },
    Delete {
        relation_id: u32,
        old: Row,
    },
    Skipped(u8),
}

#[derive(Debug, Default)]
pub struct Decoder {
    relations: HashMap<u32, Relation>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct DecodeError(pub String);

impl core::fmt::Display for DecodeError {
    fn fmt(&self, fmt: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(fmt, "pgoutput decode error: {}", self.0)
    }
}

impl core::error::Error for DecodeError {}

impl Decoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn relation(&self, id: u32) -> Option<&Relation> {
        self.relations.get(&id)
    }

    pub fn decode(&mut self, payload: &[u8]) -> Result<Message, DecodeError> {
        let mut reader = Reader(payload);
        match reader.u8()? {
            b'B' => Ok(Message::Begin {
                final_lsn: reader.u64()?,
                commit_timestamp: reader.u64()?,
                xid: reader.u32()?,
            }),
            b'C' => {
                let _flags = reader.u8()?;
                Ok(Message::Commit {
                    commit_lsn: reader.u64()?,
                    end_lsn: reader.u64()?,
                })
            }
            b'R' => {
                let id = reader.u32()?;
                let namespace = reader.cstring()?;
                let name = reader.cstring()?;
                let replica_identity = reader.u8()?;
                let ncols = reader.u16()?;
                let mut columns = Vec::with_capacity(ncols as usize);
                for _ in 0..ncols {
                    let _flags = reader.u8()?;
                    columns.push(reader.cstring()?);
                    let _type_oid = reader.u32()?;
                    let _type_mod = reader.u32()?;
                }
                let relation = Relation {
                    id,
                    namespace,
                    name,
                    replica_identity,
                    columns,
                };
                self.relations.insert(id, relation.clone());
                Ok(Message::Relation(relation))
            }
            b'I' => {
                let id = reader.u32()?;
                reader.expect(b'N')?;
                let new = self.tuple_data(&mut reader, id)?;
                Ok(Message::Insert {
                    relation_id: id,
                    new,
                })
            }
            b'U' => {
                let id = reader.u32()?;
                let old = match reader.peek() {
                    Some(b'K' | b'O') => {
                        reader.u8()?;
                        Some(self.tuple_data(&mut reader, id)?)
                    }
                    _ => None,
                };
                reader.expect(b'N')?;
                let new = self.tuple_data(&mut reader, id)?;
                Ok(Message::Update {
                    relation_id: id,
                    old,
                    new,
                })
            }
            b'D' => {
                let id = reader.u32()?;
                let tag = reader.u8()?;
                if tag != b'K' && tag != b'O' {
                    return Err(DecodeError(format!("delete: unexpected tuple tag {tag}")));
                }
                let old = self.tuple_data(&mut reader, id)?;
                Ok(Message::Delete {
                    relation_id: id,
                    old,
                })
            }
            tag @ (b'O' | b'Y' | b'T' | b'M') => Ok(Message::Skipped(tag)),
            other => Err(DecodeError(format!("unknown message tag {other}"))),
        }
    }

    fn tuple_data(&self, reader: &mut Reader<'_>, relation_id: u32) -> Result<Row, DecodeError> {
        let relation = self
            .relations
            .get(&relation_id)
            .ok_or_else(|| DecodeError(format!("unknown relation {relation_id}")))?;

        let ncols = reader.u16()?;
        let mut row = Row::new();
        for index in 0..ncols as usize {
            let column = relation
                .columns
                .get(index)
                .ok_or_else(|| DecodeError("more values than columns".to_owned()))?;
            match reader.u8()? {
                b'n' => {
                    row.insert(column.clone(), None);
                }
                // Unchanged TOAST: the column is absent from the row, exactly
                // like the Elixir decoder rejects it from the map.
                b'u' => {}
                b't' => {
                    let len = reader.u32()? as usize;
                    let value = reader.take(len)?;
                    row.insert(
                        column.clone(),
                        Some(String::from_utf8_lossy(value).into_owned()),
                    );
                }
                other => return Err(DecodeError(format!("unknown value tag {other}"))),
            }
        }
        Ok(row)
    }
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn u8(&mut self) -> Result<u8, DecodeError> {
        let value = *self
            .0
            .first()
            .ok_or_else(|| DecodeError("truncated".to_owned()))?;
        self.0 = &self.0[1..];
        Ok(value)
    }

    fn peek(&self) -> Option<u8> {
        self.0.first().copied()
    }

    fn expect(&mut self, tag: u8) -> Result<(), DecodeError> {
        let got = self.u8()?;
        if got == tag {
            Ok(())
        } else {
            Err(DecodeError(format!("expected {tag}, got {got}")))
        }
    }

    fn u16(&mut self) -> Result<u16, DecodeError> {
        let bytes: [u8; 2] = self.take(2)?.try_into().expect("length checked");
        Ok(u16::from_be_bytes(bytes))
    }

    fn u32(&mut self) -> Result<u32, DecodeError> {
        let bytes: [u8; 4] = self.take(4)?.try_into().expect("length checked");
        Ok(u32::from_be_bytes(bytes))
    }

    fn u64(&mut self) -> Result<u64, DecodeError> {
        let bytes: [u8; 8] = self.take(8)?.try_into().expect("length checked");
        Ok(u64::from_be_bytes(bytes))
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], DecodeError> {
        if self.0.len() < len {
            return Err(DecodeError("truncated".to_owned()));
        }
        let (taken, rest) = self.0.split_at(len);
        self.0 = rest;
        Ok(taken)
    }

    fn cstring(&mut self) -> Result<String, DecodeError> {
        let end = self
            .0
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(|| DecodeError("unterminated cstring".to_owned()))?;
        let text = String::from_utf8_lossy(&self.0[..end]).into_owned();
        self.0 = &self.0[end + 1..];
        Ok(text)
    }
}

/// LSN integer to the textual "X/Y" form Postgres tools use.
pub fn format_lsn(lsn: u64) -> String {
    format!("{:X}/{:X}", lsn >> 32, lsn & 0xFFFF_FFFF)
}

/// Textual "X/Y" LSN to integer; `None` or "0/0" means from the slot's
/// position.
pub fn parse_lsn(text: Option<&str>) -> u64 {
    let Some(text) = text else { return 0 };
    let Some((hi, lo)) = text.split_once('/') else {
        return 0;
    };
    let hi = u64::from_str_radix(hi, 16).unwrap_or(0);
    let lo = u64::from_str_radix(lo, 16).unwrap_or(0);
    (hi << 32) + lo
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
mod tests {
    use super::*;

    fn cstr(text: &str) -> Vec<u8> {
        let mut out = text.as_bytes().to_vec();
        out.push(0);
        out
    }

    fn relation_message(id: u32, name: &str, columns: &[&str]) -> Vec<u8> {
        let mut out = vec![b'R'];
        out.extend(id.to_be_bytes());
        out.extend(cstr("public"));
        out.extend(cstr(name));
        out.push(b'f');
        out.extend((columns.len() as u16).to_be_bytes());
        for column in columns {
            out.push(0);
            out.extend(cstr(column));
            out.extend(25u32.to_be_bytes());
            out.extend((-1i32).to_be_bytes());
        }
        out
    }

    fn text_value(value: &str) -> Vec<u8> {
        let mut out = vec![b't'];
        out.extend((value.len() as u32).to_be_bytes());
        out.extend(value.as_bytes());
        out
    }

    #[test]
    fn decodes_begin_commit_relation_and_dml() {
        let mut decoder = Decoder::new();

        let mut begin = vec![b'B'];
        begin.extend(42u64.to_be_bytes());
        begin.extend(7u64.to_be_bytes());
        begin.extend(9u32.to_be_bytes());
        assert_eq!(
            decoder.decode(&begin).unwrap(),
            Message::Begin {
                final_lsn: 42,
                commit_timestamp: 7,
                xid: 9
            }
        );

        let relation = relation_message(1, "users", &["id", "name"]);
        let Message::Relation(rel) = decoder.decode(&relation).unwrap() else {
            panic!("expected relation");
        };
        assert_eq!(rel.name, "users");
        assert_eq!(rel.columns, vec!["id", "name"]);

        let mut insert = vec![b'I'];
        insert.extend(1u32.to_be_bytes());
        insert.push(b'N');
        insert.extend(2u16.to_be_bytes());
        insert.extend(text_value("u1"));
        insert.extend(text_value("ada"));
        let Message::Insert { new, .. } = decoder.decode(&insert).unwrap() else {
            panic!("expected insert");
        };
        assert_eq!(new.get("id"), Some(&Some("u1".to_owned())));
        assert_eq!(new.get("name"), Some(&Some("ada".to_owned())));

        // Update with full old tuple (REPLICA IDENTITY FULL) and an
        // unchanged-toast column in the new tuple.
        let mut update = vec![b'U'];
        update.extend(1u32.to_be_bytes());
        update.push(b'O');
        update.extend(2u16.to_be_bytes());
        update.extend(text_value("u1"));
        update.extend(text_value("ada"));
        update.push(b'N');
        update.extend(2u16.to_be_bytes());
        update.extend(text_value("u1"));
        update.push(b'u');
        let Message::Update { old, new, .. } = decoder.decode(&update).unwrap() else {
            panic!("expected update");
        };
        assert_eq!(old.unwrap().get("name"), Some(&Some("ada".to_owned())));
        assert!(
            !new.contains_key("name"),
            "unchanged toast column is absent"
        );

        let mut delete = vec![b'D'];
        delete.extend(1u32.to_be_bytes());
        delete.push(b'O');
        delete.extend(2u16.to_be_bytes());
        delete.extend(text_value("u1"));
        delete.push(b'n');
        let Message::Delete { old, .. } = decoder.decode(&delete).unwrap() else {
            panic!("expected delete");
        };
        assert_eq!(old.get("id"), Some(&Some("u1".to_owned())));
        assert_eq!(old.get("name"), Some(&None));

        let mut commit = vec![b'C', 0];
        commit.extend(42u64.to_be_bytes());
        commit.extend(43u64.to_be_bytes());
        commit.extend(1u64.to_be_bytes());
        assert_eq!(
            decoder.decode(&commit).unwrap(),
            Message::Commit {
                commit_lsn: 42,
                end_lsn: 43
            }
        );
    }

    #[test]
    fn lsn_round_trip() {
        assert_eq!(format_lsn(0x1_0000_002A), "1/2A");
        assert_eq!(parse_lsn(Some("1/2A")), 0x1_0000_002A);
        assert_eq!(parse_lsn(None), 0);
        assert_eq!(parse_lsn(Some("0/0")), 0);
    }
}
