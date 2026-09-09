{
  description = "Development environments for sap-mock-data";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachSystem [ "x86_64-linux" ] (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        python = pkgs.python313;
        commonPackages = [ pkgs.uv python ];
        commonEnv = {
          UV_PYTHON = "${python}/bin/python";
          UV_PYTHON_DOWNLOADS = "never";
          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
            pkgs.stdenv.cc.cc.lib
            pkgs.zlib
          ];
        };
      in
      {
        devShells.default = pkgs.mkShell (
          commonEnv
          // {
            packages = commonPackages;
          }
        );

        devShells.spark = pkgs.mkShell (
          commonEnv
          // {
            packages = commonPackages ++ [ pkgs.jdk21_headless ];
            JAVA_HOME = "${pkgs.jdk21_headless}";
          }
        );

        formatter = pkgs.nixfmt-tree;
      }
    );
}
