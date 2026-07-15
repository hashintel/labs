{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          nativeBuildInputs = with pkgs; [
            nodejs_24
	    jq
            corepack_24
            # examples/sap-mock generator (or: venv + requirements.txt)
            (python3.withPackages (ps: [
              ps.deltalake
              ps.pandas
              ps.numpy
              ps.faker
              ps.pyarrow
            ]))
          ];
        };
      }
    );
}
