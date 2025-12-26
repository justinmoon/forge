{ config, lib, pkgs, ... }:

with lib;

let
  cfg = config.services.forge;
  gitPkg = pkgs.git;
  bashPkg = pkgs.bash;
  coreutils = pkgs.coreutils;
in
{
  options.services.forge = {
    enable = mkEnableOption "forge - single-tenant Git forge";

    package = mkOption {
      type = types.package;
      description = "The forge package to use.";
      # No default - must be provided by the user
    };

    user = mkOption {
      type = types.str;
      default = "forge";
      description = "User account under which forge runs.";
    };

    group = mkOption {
      type = types.str;
      default = "forge";
      description = "Group under which forge runs.";
    };

    dataDir = mkOption {
      type = types.path;
      default = "/var/lib/forge";
      description = "Directory where forge stores its data (repos, database, logs).";
    };

    port = mkOption {
      type = types.port;
      default = 3030;
      description = "Port on which the forge HTTP server listens.";
    };

    mergePassword = mkOption {
      type = types.str;
      default = "changeme";
      description = ''
        Password required for merge operations.
        WARNING: Store this securely, preferably using agenix or sops-nix.
      '';
    };

    domain = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "forge.example.com";
      description = ''
        Domain name for the forge instance.
        If set, enables automatic Caddy reverse proxy configuration.
      '';
    };

    enableCaddy = mkOption {
      type = types.bool;
      default = cfg.domain != null;
      description = "Whether to enable Caddy reverse proxy.";
    };

    sshKeys = mkOption {
      type = types.listOf types.str;
      default = [];
      example = [ "ssh-ed25519 AAAAC3... user@host" ];
      description = ''
        SSH public keys allowed to push/pull from repositories.
        These keys will be added to the forge user's authorized_keys.
      '';
    };

    allowedPubkeys = mkOption {
      type = types.listOf types.str;
      default = [];
      example = [ "npub1..." "hex-pubkey..." ];
      description = ''
        Nostr public keys (npub or hex format) allowed to authenticate to the web UI.
        Leave empty to disable Nostr authentication.
      '';
    };

    jobTimeout = mkOption {
      type = types.int;
      default = 3600;
      example = 7200;
      description = ''
        Maximum time in seconds that a CI job can run before being automatically killed.
        Default is 3600 seconds (1 hour).
      '';
    };

    containerizedCI = mkOption {
      type = types.bool;
      default = false;
      description = ''
        Run CI jobs inside rootless Podman containers for isolation.
        Each job gets its own network namespace, eliminating port conflicts.
        Requires podman and slirp4netns to be available.
      '';
    };

    ciImage = mkOption {
      type = types.str;
      default = "forge-ci:latest";
      description = ''
        Container image to use for CI jobs when containerizedCI is enabled.
        Build with: nix build .#ci-image && podman load < result
      '';
    };
  };

  config = mkIf cfg.enable {
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = cfg.dataDir;
      createHome = true;
      description = "forge service user";
      shell = "${pkgs.bash}/bin/bash";
      openssh.authorizedKeys.keys = mkIf (cfg.sshKeys != []) cfg.sshKeys;
    };

    users.groups.${cfg.group} = {};
    
    # Configure git identity for merge commits
    system.activationScripts.forge-git-config = ''
      if [ -d "${cfg.dataDir}" ]; then
        ${pkgs.sudo}/bin/sudo -u ${cfg.user} ${pkgs.git}/bin/git config --global user.email "forge@${cfg.domain}"
        ${pkgs.sudo}/bin/sudo -u ${cfg.user} ${pkgs.git}/bin/git config --global user.name "Forge"
      fi
    '';

    systemd.services.forge = {
      description = "forge - Git forge service";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      environment = {
        FORGE_DATA_DIR = cfg.dataDir;
        FORGE_PORT = toString cfg.port;
        FORGE_MERGE_PASSWORD = cfg.mergePassword;
        FORGE_DOMAIN = mkIf (cfg.domain != null) cfg.domain;
        FORGE_ALLOWED_PUBKEYS = mkIf (cfg.allowedPubkeys != []) (builtins.concatStringsSep "," cfg.allowedPubkeys);
        FORGE_JOB_TIMEOUT = toString cfg.jobTimeout;
        NODE_ENV = "production";
        HOME = cfg.dataDir;
      } // optionalAttrs cfg.containerizedCI {
        FORGE_CI_CONTAINER = "1";
        FORGE_CI_IMAGE = cfg.ciImage;
      };

      path = [ gitPkg bashPkg coreutils pkgs.nix pkgs.just ]
        # /run/wrappers provides setuid newuidmap/newgidmap on NixOS
        ++ optionals cfg.containerizedCI [ pkgs.podman pkgs.slirp4netns "/run/wrappers" ];
      
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        ExecStart = "${cfg.package}/bin/forge server";
        Restart = "on-failure";
        RestartSec = "10s";

        # Hardening
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.dataDir ];
        NoNewPrivileges = !cfg.containerizedCI; # Podman needs new privileges for user namespaces
        PrivateDevices = !cfg.containerizedCI; # Podman needs /dev/net/tun for slirp4netns
        ProtectKernelTunables = !cfg.containerizedCI; # Podman may need kernel tuning
        ProtectKernelModules = true;
        ProtectControlGroups = !cfg.containerizedCI; # Podman needs cgroup access
        RestrictAddressFamilies = [ "AF_UNIX" "AF_INET" "AF_INET6" ]
          ++ optionals cfg.containerizedCI [ "AF_NETLINK" ];
        RestrictNamespaces = !cfg.containerizedCI; # Podman needs user/network namespaces
        LockPersonality = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = !cfg.containerizedCI;
        RemoveIPC = true;
        PrivateMounts = !cfg.containerizedCI; # Podman needs mount namespace access
      };
    };

    # Optional Caddy reverse proxy
    services.caddy = mkIf (cfg.enableCaddy && cfg.domain != null) {
      enable = true;
      virtualHosts.${cfg.domain} = {
        extraConfig = ''
          reverse_proxy localhost:${toString cfg.port}
        '';
      };
    };

    # Ensure Git and forge CLI are available system-wide
    environment.systemPackages = [ pkgs.git pkgs.just cfg.package ];
  };
}
