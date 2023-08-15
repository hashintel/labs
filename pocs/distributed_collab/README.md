# DistributedCollab

This is a PoC of a distributed collab server that can auto-scale and distribute entity instances.

## Setup

The following **requirements** need to be met to run the system:

- Erlang version `23`-`25`
- Elixir version `1.14`
- Rust version `1.65+`

Start by installing dependencies

```sh
$ mix deps.get
```

Make sure the following compiles (Rust crate)

```sh
$ RUSTLER_NIF_VERSION=2.16 mix compile
```

We can now start a cluster with two instances as follows:

**Terminal 1**:

```sh
$ RUSTLER_NIF_VERSION=2.16 iex --name a@127.0.0.1 -S mix run --no-halt
```

**Terminal 2**:

```sh
$ RUSTLER_NIF_VERSION=2.16 PORT=4001 iex --name b@127.0.0.1 -S mix run --no-halt
```

You can now access the following two pages:

- http://127.0.0.1:4000/index.html?subscribe_to=abc,def
- http://127.0.0.1:4001/index.html?subscribe_to=def,xyz

to send patches. The patch is published when pressing (CTRL/CMD)+s. The boxes must contain valid JSON.
