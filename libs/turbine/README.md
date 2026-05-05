# Turbine

A very experimental, very alpha Rust code generator for blockprotocol graph types.

This project will gradually add new functionality and tests, be aware that for now periodic breakage and poor test coverage are to be expected (which will hopefully change soon).

This workspace consists of several crates:

* `bin/cli`: The main entry-point for generation
* `lib/codegen`: Code generator of the code, input is a collection of types, output is a map of path to content
* `lib/skeletor`: Takes the output from codegen and bootstraps a new `no-std` library crate
* `lib/turbine`: The underlying library which includes all types and traits that are needed and references in the generated code


Configuration for turbine can be done via CLI arguments or `turbine.toml`/`.turbine.toml` files, the contents of the files are as follows:
(all properties are optional)

```toml
# The root of the new library package
root = "..."

# The style of package, either `mod` (will create `mod.rs` files) or `module`
style = "mod"

# Custom flavors for URLs which do not follow the blockprotocol or HASH layout
# must have the attributes: `name`, `mode`, and `pattern`.
# The `mode` can either be `MatchPath` or `MatchAll`, depending on the mode the pattern must capture the following groups:
# * `MatchPath`: `kind` (either `entity`, `property`, `data`), `id`, `namespace` (optional)
# * `MatchAll`: `origin`, `kind` (either `entity`, `property`, `data`), `id`, `namespace` (optional)
flavors = []

# Force the deletion of any previous directory at `root`.
force = false

# Turbine dependency configuration
[turbine]
#kind = "crates-io" # currently does not work, use turbine from crates.io
#kind = "git"
#value = {url = "...", rev = "...", tag = "...", branch = "..."} # rev, tag, branch are optional
kind = "path"
value = "../turbine" # relative path your CWD

# Origin where types are to be fetched, either `remote` (will query the HASH-Graph) or `local`, pointing to a JSON file
[origin]
type = "remote"
value = "http://example.com/"

# Overrides, when applying flavors these can be used to replace specific parts with other constants. 
# Especially helpful in development environments. 
# The namespace of an override is only applied if the origin of the override matched.
[[overrides]]
[overrides.origin]
matches = "localhost:3000"
replacement = "your-org"

[overrides.namespace]
matches = "alice"
replacement = "your-org"
```

## Credit

Developed by [Bilal Mahmoud](https://github.com/indietyp).
