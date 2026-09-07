{
  description = "integrations_rs: Rust port of the integrations engine";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs = {
        nixpkgs.follows = "nixpkgs";
      };
    };
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      rust-overlay,
      ...
    }:

    flake-utils.lib.eachDefaultSystem (
      system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs {
          inherit system overlays;
        };
        toolchain = (pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml).override {
          extensions = [
            "rust-src"
          ];
        };
      in
      with pkgs;
      {
        devShells.default = pkgs.mkShell {
          nativeBuildInputs = with pkgs; [
            rust-analyzer-unwrapped
            cargo-flamegraph
            cargo-machete
            cargo-nextest
            gcc
            cmake
            pkg-config
            tlaplus
          ];
          buildInputs = [
            toolchain
          ];
          RUST_SRC_PATH = "${toolchain}/lib/rustlib/src/rust/library";
        };
      }
    );
}
