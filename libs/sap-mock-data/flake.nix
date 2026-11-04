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
        python =
          (pkgs.python313.override {
            self = python;
            sourceVersion = {
              major = "3";
              minor = "13";
              patch = "18";
              suffix = "";
            };
            hash = "sha256-q7AQLm1K4CdQm8uCMn2d2FUVtEo7qK1TjPxemEcCn2g=";
          }).overrideAttrs
            (old: {
              # Python 3.13.18 needs the platform-aware MIME types patch.
              patches = map (
                patch:
                if toString patch == "${nixpkgs}/pkgs/development/interpreters/python/cpython/mimetypes.patch" then
                  pkgs.fetchurl {
                    url = "https://raw.githubusercontent.com/NixOS/nixpkgs/f0d8eff3cd4427c0fb742ca44f8e6ceeb6347193/pkgs/development/interpreters/python/cpython/3.14/mimetypes.patch";
                    hash = "sha256-X7CnHn5wtP0BbR4gKmzv9xSmTH1ezitfLz3w6iesJF4=";
                  }
                else
                  patch
              ) old.patches;
            });
        uv = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
          pname = "uv";
          version = "0.13.6";
          src = pkgs.fetchurl {
            url = "https://github.com/astral-sh/uv/releases/download/${finalAttrs.version}/uv-x86_64-unknown-linux-musl.tar.gz";
            hash = "sha256-XWHya2xyE3ee2pDtxpceprC3lr+41JpXTIrWm1mDhUg=";
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
      assert pkgs.lib.assertMsg (
        python.version == pkgs.lib.strings.trim (builtins.readFile ./.python-version)
      ) "The Nix interpreter must match .python-version.";
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
