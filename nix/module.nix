{ config, lib, pkgs, ... }:

with lib;

let
  cfg = config.services.forge;
  gitPkg = pkgs.git;
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
  };

  config = mkIf cfg.enable {
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = cfg.dataDir;
      createHome = true;
      description = "forge service user";
    };

    users.groups.${cfg.group} = {};

    systemd.services.forge = {
      description = "forge - Git forge service";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      environment = {
        FORGE_DATA_DIR = cfg.dataDir;
        FORGE_PORT = toString cfg.port;
        FORGE_MERGE_PASSWORD = cfg.mergePassword;
        NODE_ENV = "production";
        HOME = cfg.dataDir;
      };

      path = [ gitPkg ];
      
      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        ExecStart = "${cfg.package}/bin/forge";
        Restart = "on-failure";
        RestartSec = "10s";

        # Hardening
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.dataDir ];
        NoNewPrivileges = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [ "AF_UNIX" "AF_INET" "AF_INET6" ];
        RestrictNamespaces = true;
        LockPersonality = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        RemoveIPC = true;
        PrivateMounts = true;
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

    # Ensure Git is available for the service
    environment.systemPackages = [ pkgs.git ];
  };
}
