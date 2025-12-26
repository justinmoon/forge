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
        binPath = pkgs.lib.makeBinPath (
          [ pkgs.bash pkgs.coreutils pkgs.git pkgs.nodejs pkgs.nix pkgs.bun ]
          ++ pkgs.lib.optional pkgs.stdenv.isLinux pkgs.chromium
        );
        
        forge = pkgs.stdenv.mkDerivation {
          pname = "forge";
          version = "0.1.0";
          src = ./.;

          nativeBuildInputs = [ pkgs.bun ];
          buildInputs = [ pkgs.git ];

          buildPhase = ''
            export HOME=$TMPDIR
            bun install --no-progress
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

        # Minimal CI container image with just, git, nix, and basic tools
        ciImage = pkgs.dockerTools.buildLayeredImage {
          name = "forge-ci";
          tag = "latest";

          contents = [
            pkgs.bashInteractive
            pkgs.coreutils
            pkgs.git
            pkgs.nix
            pkgs.cacert
            pkgs.just
            pkgs.gnugrep
            pkgs.gnutar
            pkgs.gzip
          ];

          extraCommands = ''
            # Create directories
            mkdir -p root tmp etc work

            # Minimal passwd/group - with --userns=keep-id, host UID maps to container
            # Use root user in container; podman maps it to host user
            echo 'root:x:0:0:root:/root:/bin/bash' > etc/passwd
            echo 'root:x:0:' > etc/group

            # NSS config for user lookups
            echo 'hosts: files dns' > etc/nsswitch.conf

            # Create nix config directory
            mkdir -p etc/nix
            echo 'experimental-features = nix-command flakes' > etc/nix/nix.conf
            echo 'sandbox = false' >> etc/nix/nix.conf

            # Create FHS compatibility symlinks for scripts with shebangs like #!/usr/bin/env
            mkdir -p usr/bin
            ln -s ${pkgs.coreutils}/bin/env usr/bin/env

            # Create dynamic linker symlinks for running unpatched binaries (like biome from npm)
            mkdir -p lib64
            ln -s ${pkgs.glibc}/lib/ld-linux-x86-64.so.2 lib64/ld-linux-x86-64.so.2
          '';

          config = {
            Env = [
              "HOME=/root"
              "USER=root"
              "PATH=/bin:/usr/bin:${pkgs.nix}/bin:${pkgs.git}/bin:${pkgs.just}/bin"
              "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              # NIX_LD provides the dynamic linker for unpatched binaries
              "NIX_LD=${pkgs.glibc}/lib/ld-linux-x86-64.so.2"
              # NIX_LD_LIBRARY_PATH provides common shared libraries
              "NIX_LD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath [ pkgs.glibc pkgs.gcc.cc.lib ]}"
            ];
            WorkingDir = "/work";
            # Don't set User - let --userns=keep-id handle UID mapping
          };
        };

      in {
        packages = {
          default = forge;
          forge = forge;
          ci-image = ciImage;
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
              export PATH="${binPath}"
              ${pkgs.lib.optionalString pkgs.stdenv.isLinux ''
                export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
                export PLAYWRIGHT_BROWSERS_PATH=0
                export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
              ''}
              echo "Installing dependencies with npm..."
              npm install --include=dev --no-package-lock
              ${pkgs.lib.optionalString (!pkgs.stdenv.isLinux) ''
              echo "Installing Playwright browsers..."
              npx playwright install chromium
              ''}
              echo "Running biome check..."
              npx @biomejs/biome check src/realtime src/ci/runner.ts src/cli/index.ts src/http/handlers.ts src/views/jobs.ts src/views/merge-requests.ts tests/job-log-stream.spec.ts scripts/dev.sh
              echo "Running TypeScript build..."
              npx tsc --noEmit
              echo "Running bun test..."
              bun test tests/*.test.ts
              echo "Running Playwright tests..."
              npx playwright test --config=playwright.config.ts tests/job-log-stream.spec.ts
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
