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
        # Use the patched static release without changing the shell's Python or Java.
        uv = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
          pname = "uv";
          version = "0.13.4";
          src = pkgs.fetchurl {
            url = "https://github.com/astral-sh/uv/releases/download/${finalAttrs.version}/uv-x86_64-unknown-linux-musl.tar.gz";
            hash = "sha256-KNQ4X5+dHRx2VNhbOFXg4mFbL2zBMTai7f+Fi73Bb/E=";
          };
          dontConfigure = true;
          dontBuild = true;
          installPhase = ''
            runHook preInstall
            install -Dm755 -t "$out/bin" uv uvx
            runHook postInstall
          '';
        });
        commonPackages = [
          uv
          python
        ];
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
