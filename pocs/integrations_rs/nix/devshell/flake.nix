{
  description = "integrations_rs development shell without repository source ingestion";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
    in
    {
      devShells = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system}; in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              rustc
              cargo
              cargo-nextest
              clippy
              rustfmt
              # duckdb bundled build
              gcc
              cmake
              pkg-config
              # TLA+ model checking (local/spec)
              tlaplus
            ];
          };
        });
    };
}
