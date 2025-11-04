{
  description = "forge - Single-tenant Git forge";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        
        forge = pkgs.stdenv.mkDerivation {
          pname = "forge";
          version = "0.1.0";
          src = ./.;

          nativeBuildInputs = [ pkgs.bun ];
          buildInputs = [ pkgs.git ];

          buildPhase = ''
            export HOME=$TMPDIR
            bun install --frozen-lockfile
          '';

          installPhase = ''
            mkdir -p $out/bin $out/share/forge
            cp -r . $out/share/forge/
            
            cat > $out/bin/forge <<EOF
            #!/usr/bin/env bash
            exec ${pkgs.bun}/bin/bun run $out/share/forge/src/cli/index.ts "\$@"
            EOF
            chmod +x $out/bin/forge
          '';
        };

      in {
        packages = {
          default = forge;
          forge = forge;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.bun
            pkgs.git
            pkgs.typescript
          ];
        };

        apps = {
          default = {
            type = "app";
            program = "${forge}/bin/forge";
          };
          forge = {
            type = "app";
            program = "${forge}/bin/forge";
          };
          pre-merge = {
            type = "app";
              program = toString (pkgs.writeShellScript "pre-merge-check" ''
              set -euo pipefail
              export PATH="${pkgs.lib.makeBinPath [ pkgs.bash pkgs.coreutils pkgs.git pkgs.nodejs pkgs.nix pkgs.bun ]}"
              echo "Installing dependencies with npm..."
              npm install --include=dev --no-package-lock
              echo "Installing Playwright browsers..."
              npx playwright install chromium
              echo "Running biome check..."
              npx @biomejs/biome check src/realtime src/ci/runner.ts src/cli/index.ts src/http/handlers.ts src/views/jobs.ts src/views/merge-requests.ts tests/job-log-stream.spec.ts scripts/dev.sh examples/demo-stream
              echo "Running TypeScript build..."
              npx tsc --noEmit
              echo "Running Playwright tests..."
              npx playwright test
              echo "Pre-merge checks passed!"
            '');
          };
          post-merge = {
            type = "app";
            program = toString (pkgs.writeShellScript "post-merge-deploy" ''
              export PATH="${pkgs.lib.makeBinPath [ pkgs.git pkgs.nix pkgs.coreutils pkgs.bash pkgs.openssh ]}"
              exec ${pkgs.bash}/bin/bash ${./scripts/post-merge-deploy.sh} "$@"
            '');
          };
        };
      }
    ) // {
      # NixOS module for deployment
      nixosModules.forge = import ./nix/module.nix;
      nixosModules.default = self.nixosModules.forge;
    };
}
