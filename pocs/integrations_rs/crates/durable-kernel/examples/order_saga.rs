//! A staged workflow (order fulfillment) as a state machine over the kernel.
//!
//! Each order moves through Placed → Reserved → Charged → Shipped, with a
//! compensation path Reserved → Releasing → Cancelled when payment is
//! declined. The example demonstrates the staged-workflow patterns from
//! `local/docs/staged-workflow-patterns.md`:
//!
//! - each state is its own struct carrying only the data valid in that state;
//! - every legal transition is a method that consumes the source state and
//!   returns the target state, so transitions that were never written do not
//!   compile;
//! - one transition table serves both `validate` (checked at command time)
//!   and `apply` (replayed as fact);
//! - compensation is a forward path through ordinary states and events.
//!
//! Run with `cargo run -p durable-kernel --example order_saga`. One order
//! ships; one is declined at payment and compensates back to cancelled.

#![allow(
    clippy::expect_used,
    clippy::print_stdout,
    // Transitions consume self so a stale state cannot be reused; that
    // signature is the pattern under demonstration.
    clippy::missing_const_for_fn,
    clippy::unused_self
)]

use std::collections::BTreeMap;
use std::time::Duration;

use durable_kernel::domain::{
    DomainEvent, Executor, Fold, PartitionKey, Rejection, Retry, SimpleDomain,
};
use durable_kernel::runtime::{Kernel, KernelConfig};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum OrderEvent {
    OrderPlaced { order: String, items: u32 },
    StockReserved { order: String, reservation: String },
    ReservationFailed { order: String, reason: String },
    PaymentCaptured { order: String, receipt_id: String },
    PaymentDeclined { order: String },
    StockReleased { order: String },
    OrderShipped { order: String, tracking: String },
}

impl OrderEvent {
    fn order(&self) -> &str {
        match self {
            Self::OrderPlaced { order, .. }
            | Self::StockReserved { order, .. }
            | Self::ReservationFailed { order, .. }
            | Self::PaymentCaptured { order, .. }
            | Self::PaymentDeclined { order }
            | Self::StockReleased { order }
            | Self::OrderShipped { order, .. } => order,
        }
    }
}

impl DomainEvent for OrderEvent {
    fn name() -> &'static str {
        "order_saga_event"
    }

    fn partition(&self) -> PartitionKey {
        PartitionKey::parse("orders").expect("static key should parse")
    }
}

// Each state carries only the data that exists in that state. An order that
// is not yet reserved has no reservation ID anywhere in the type.

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Placed {
    items: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Reserved {
    items: u32,
    reservation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Charged {
    reservation: String,
    receipt_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Releasing {
    reservation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Shipped {
    tracking: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Cancelled {
    reason: String,
}

// The legal transitions, one method each. A transition that is not written
// here cannot be expressed anywhere else: `apply` and `validate` both go
// through these methods, and each consumes its source state.

impl Placed {
    fn reserve(self, reservation: String) -> Reserved {
        Reserved {
            items: self.items,
            reservation,
        }
    }

    fn reject(self, reason: String) -> Cancelled {
        Cancelled { reason }
    }
}

impl Reserved {
    fn charge(self, receipt_id: String) -> Charged {
        Charged {
            reservation: self.reservation,
            receipt_id,
        }
    }

    fn decline(self) -> Releasing {
        Releasing {
            reservation: self.reservation,
        }
    }
}

impl Releasing {
    fn released(self) -> Cancelled {
        Cancelled {
            reason: "payment declined; reservation released".to_owned(),
        }
    }
}

impl Charged {
    fn ship(self, tracking: String) -> Shipped {
        Shipped { tracking }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum OrderState {
    Placed(Placed),
    Reserved(Reserved),
    Charged(Charged),
    Releasing(Releasing),
    Shipped(Shipped),
    Cancelled(Cancelled),
}

impl OrderState {
    fn label(&self) -> &'static str {
        match self {
            Self::Placed(_) => "placed",
            Self::Reserved(_) => "reserved",
            Self::Charged(_) => "charged",
            Self::Releasing(_) => "releasing",
            Self::Shipped(_) => "shipped",
            Self::Cancelled(_) => "cancelled",
        }
    }

    fn is_terminal(&self) -> bool {
        matches!(self, Self::Shipped(_) | Self::Cancelled(_))
    }
}

/// The transition table. `validate` checks a proposal against it and
/// `apply` replays it as fact, so a guard and its transition can never
/// disagree. `state` is `None` for an order with no history.
///
/// Takes the state by value: each legal arm consumes it through a
/// transition method. Callers clone once at the map lookup, because the
/// map keeps the old state until the transition succeeds.
#[allow(
    // The rejection arms stay separate instead of collapsing into a
    // wildcard so that adding a state or event variant fails compilation
    // here until the new pairs are decided.
    clippy::match_same_arms
)]
fn transition(state: Option<OrderState>, event: &OrderEvent) -> Result<OrderState, Rejection> {
    use OrderEvent as E;
    use OrderState as S;
    let from = state.as_ref().map_or("none", OrderState::label);
    let illegal = || {
        Rejection::new(format!(
            "event {event:?} is not legal for an order in state {from}"
        ))
    };
    match (state, event) {
        (None, E::OrderPlaced { items, .. }) => Ok(S::Placed(Placed { items: *items })),
        (Some(S::Placed(p)), E::StockReserved { reservation, .. }) => {
            Ok(S::Reserved(p.reserve(reservation.clone())))
        }
        (Some(S::Placed(p)), E::ReservationFailed { reason, .. }) => {
            Ok(S::Cancelled(p.reject(reason.clone())))
        }
        (Some(S::Reserved(r)), E::PaymentCaptured { receipt_id, .. }) => {
            Ok(S::Charged(r.charge(receipt_id.clone())))
        }
        (Some(S::Reserved(r)), E::PaymentDeclined { .. }) => Ok(S::Releasing(r.decline())),
        (Some(S::Releasing(r)), E::StockReleased { .. }) => Ok(S::Cancelled(r.released())),
        (Some(S::Charged(c)), E::OrderShipped { tracking, .. }) => {
            Ok(S::Shipped(c.ship(tracking.clone())))
        }
        (Some(_), E::OrderPlaced { .. }) => Err(Rejection::new("order already exists")),
        (None, _) => Err(illegal()),
        (Some(S::Placed(_)), _) => Err(illegal()),
        (Some(S::Reserved(_)), _) => Err(illegal()),
        (Some(S::Releasing(_)), _) => Err(illegal()),
        (Some(S::Charged(_)), _) => Err(illegal()),
        (Some(S::Shipped(_) | S::Cancelled(_)), _) => Err(illegal()),
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct OrderBook {
    orders: BTreeMap<String, OrderState>,
}

impl Fold<OrderEvent> for OrderBook {
    fn validate(&self, event: &OrderEvent) -> Result<(), Rejection> {
        transition(self.orders.get(event.order()).cloned(), event).map(|_next| ())
    }

    fn apply(&mut self, event: &OrderEvent) {
        // History was validated when it was recorded; a mismatch here can
        // only mean the fold itself changed, and keeping the prior state is
        // the total, replay-safe behavior.
        if let Ok(next) = transition(self.orders.get(event.order()).cloned(), event) {
            self.orders.insert(event.order().to_owned(), next);
        }
    }
}

struct OrderDomain;

impl SimpleDomain for OrderDomain {
    type Event = OrderEvent;
    type Projection = OrderBook;
}

/// One effect per non-terminal stage. Folding a stage's completion event
/// changes the order's state, so the next `plan` call emits the following
/// stage's effect instead of repeating this one (the fixpoint contract).
#[derive(Debug, Clone, Serialize)]
enum SagaEffect {
    Reserve { order: String, items: u32 },
    Charge { order: String, reservation: String },
    Release { order: String, reservation: String },
    Ship { order: String },
}

/// Stand-in for inventory, payment, and shipping services. Payment declines
/// any order whose name contains "declined".
struct SagaExecutor;

impl SagaExecutor {
    fn act(&self, line: String) {
        println!("  [world] {line}");
    }
}

impl Executor<OrderDomain> for SagaExecutor {
    type Effect = SagaEffect;

    fn plan(&self, book: &OrderBook) -> Vec<SagaEffect> {
        book.orders
            .iter()
            .filter_map(|(order, state)| match state {
                OrderState::Placed(p) => Some(SagaEffect::Reserve {
                    order: order.clone(),
                    items: p.items,
                }),
                OrderState::Reserved(r) => Some(SagaEffect::Charge {
                    order: order.clone(),
                    reservation: r.reservation.clone(),
                }),
                OrderState::Releasing(r) => Some(SagaEffect::Release {
                    order: order.clone(),
                    reservation: r.reservation.clone(),
                }),
                OrderState::Charged(_) => Some(SagaEffect::Ship {
                    order: order.clone(),
                }),
                OrderState::Shipped(_) | OrderState::Cancelled(_) => None,
            })
            .collect()
    }

    async fn execute(&self, effect: &SagaEffect) -> Result<Vec<OrderEvent>, Retry> {
        match effect {
            SagaEffect::Reserve { order, items } => {
                let reservation = format!("resv-{order}");
                self.act(format!(
                    "reserved {items} items for {order} ({reservation})"
                ));
                Ok(vec![OrderEvent::StockReserved {
                    order: order.clone(),
                    reservation,
                }])
            }
            SagaEffect::Charge { order, .. } if order.contains("declined") => {
                self.act(format!("payment DECLINED for {order}"));
                Ok(vec![OrderEvent::PaymentDeclined {
                    order: order.clone(),
                }])
            }
            SagaEffect::Charge { order, .. } => {
                let receipt_id = format!("pay-{order}");
                self.act(format!("captured payment for {order} ({receipt_id})"));
                Ok(vec![OrderEvent::PaymentCaptured {
                    order: order.clone(),
                    receipt_id,
                }])
            }
            SagaEffect::Release { order, reservation } => {
                self.act(format!("released {reservation} for {order}"));
                Ok(vec![OrderEvent::StockReleased {
                    order: order.clone(),
                }])
            }
            SagaEffect::Ship { order } => {
                let tracking = format!("track-{order}");
                self.act(format!("shipped {order} ({tracking})"));
                Ok(vec![OrderEvent::OrderShipped {
                    order: order.clone(),
                    tracking,
                }])
            }
        }
    }
}

fn state_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/order_saga_demo")
}

#[tokio::main]
async fn main() {
    if std::env::args().nth(1).as_deref() == Some("reset") {
        let _ = std::fs::remove_dir_all(state_dir());
        println!("state wiped");
        return;
    }
    let key = PartitionKey::parse("orders").expect("static key should parse");
    let mut config = KernelConfig::new("ordersaga", format!("file://{}", state_dir().display()));
    config.shards = vec![u16::from(durable_kernel::domain::shard_of(&key).get())];
    config.poll_interval = Duration::from_millis(50);

    let running = Kernel::open(config)
        .expect("kernel should open")
        .register::<OrderDomain>()
        .expect("domain should register")
        .start(SagaExecutor)
        .await
        .expect("kernel should start");

    for (order, items) in [("order-7001", 3), ("order-7002-declined", 1)] {
        running
            .submit(OrderEvent::OrderPlaced {
                order: order.to_owned(),
                items,
            })
            .await
            .expect("place order should succeed");
        println!("  [submit] {order} placed");
    }

    // `validate` finds no (Placed, OrderShipped) arm in `transition`, so
    // `submit` returns the rejection and nothing is recorded.
    let premature = running
        .submit(OrderEvent::OrderShipped {
            order: "order-7001".to_owned(),
            tracking: "bogus".to_owned(),
        })
        .await;
    println!(
        "  [submit] premature ship rejected: {}",
        premature.expect_err("shipping an unpaid order should fail")
    );

    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        let all_terminal = running
            .read(&key, |book: &OrderBook| {
                !book.orders.is_empty() && book.orders.values().all(OrderState::is_terminal)
            })
            .await
            .expect("read should succeed");
        if all_terminal {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "saga did not settle");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let summary = running
        .read(&key, |book: &OrderBook| {
            book.orders
                .iter()
                .map(|(order, state)| format!("  {order:<22} {}", state.label()))
                .collect::<Vec<_>>()
        })
        .await
        .expect("summary read should succeed");
    println!("── settled ──");
    for line in summary {
        println!("{line}");
    }
    running.shutdown().await.expect("shutdown should succeed");
}
