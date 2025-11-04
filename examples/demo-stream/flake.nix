{
  description = "Forge demo repository";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        preMerge = pkgs.writeShellScriptBin "demo-pre-merge" ''
          echo "Running demo pre-merge check..."
          i=1
          while [ "$i" -le 20 ]; do
            printf 'tick %02d\n' "$i"
            sleep 1
            i=$((i + 1))
          done
          echo "Demo check complete!"
        '';
      in {
        apps.pre-merge = {
          type = "app";
          program = "${preMerge}/bin/demo-pre-merge";
        };
      });
}
