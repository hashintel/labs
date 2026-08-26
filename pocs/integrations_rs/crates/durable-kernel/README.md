# Durable kernel examples

The examples show journal recovery and at-least-once effect execution.

## Customer sync

Start with `customer_sync.rs`. It sends five customers to a simulated CRM.

```sh
cargo run -q -p durable-kernel --example customer_sync -- reset
cargo run -q -p durable-kernel --example customer_sync -- defer
cargo run -q -p durable-kernel --example customer_sync
```

The deferred run completes four customers and leaves customer 3 pending.
Customer 3 is absent from `target/customer_sync_demo/crm.json`. The next run
recovers and writes it.

Read `SyncEvent`, then the `CustomerSync` implementation of `Fold`, then
`CrmSync`. These types define the events, projection, planned effects, and CRM
writes.

Use `crash` in place of `defer` to stop after the CRM write and before its
completion event. The next run repeats the effect with the same idempotency
key, and the CRM returns the existing record.

## Webhook relay

`webhook_relay.rs` adds HTTP retries, dead-lettering, and projection snapshots.
It starts a local endpoint for the delivery attempts.

```sh
cargo run -q -p durable-kernel --example webhook_relay -- reset
cargo run -q -p durable-kernel --example webhook_relay
```

The endpoint rejects each ordinary webhook twice and accepts the third attempt.
It rejects the poison payload four times, so the relay dead-letters it. The
journal and endpoint state are stored separately under
`target/webhook_relay_demo`.

Read `RelayEvent`, then the `RelayQueue` implementation of `Fold`, then
`HttpDeliverer`. These types define the delivery history, pending queue,
planned attempts, and HTTP requests.

Use `crash` on the second command to stop after the endpoint accepts a delivery
and before its completion event. The next run repeats the effect with the same
idempotency key. The endpoint returns the existing result.
