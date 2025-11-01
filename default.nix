{ pkgs ? import <nixpkgs> {} }:

pkgs.stdenv.mkDerivation {
  pname = "forge";
  version = "0.1.0";

  src = ./.;

  nativeBuildInputs = with pkgs; [
    bun
    git
  ];

  buildPhase = ''
    export HOME=$TMPDIR
    bun install --frozen-lockfile
  '';

  installPhase = ''
    mkdir -p $out/bin $out/lib/forge

    # Copy application files
    cp -r src $out/lib/forge/
    cp -r node_modules $out/lib/forge/
    cp package.json $out/lib/forge/
    cp tsconfig.json $out/lib/forge/

    # Create wrapper script
    cat > $out/bin/forge << 'EOF'
#!/usr/bin/env bash
exec ${pkgs.bun}/bin/bun run $out/lib/forge/src/index.ts "$@"
EOF
    chmod +x $out/bin/forge
  '';

  meta = with pkgs.lib; {
    description = "Single-tenant Git forge with merge requests and CI";
    homepage = "https://github.com/yourusername/forge";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.linux ++ platforms.darwin;
  };
}
