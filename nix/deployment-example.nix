# Example NixOS configuration for deploying forge
# 
# Usage:
#   1. Add this module to your NixOS configuration imports
#   2. Configure the services.forge options
#   3. Deploy with nixos-rebuild or your preferred tool
#
# Example with flake-based deployment:
#   nixos-rebuild switch --flake .#hostname

{ config, pkgs, ... }:

{
  imports = [
    ./module.nix
  ];

  services.forge = {
    enable = true;
    
    # Domain configuration
    domain = "forge.example.com";
    enableCaddy = true;
    
    # Service configuration
    port = 3030;
    dataDir = "/var/lib/forge";
    
    # IMPORTANT: Use agenix or sops-nix for secrets in production
    mergePassword = "CHANGE_ME_IN_PRODUCTION";
    
    # Optional: override package
    # package = pkgs.forge.override { ... };
  };

  # Additional configuration
  networking.firewall.allowedTCPPorts = [ 80 443 ];

  # Backup configuration example
  services.restic.backups.forge = {
    paths = [ config.services.forge.dataDir ];
    repository = "s3:s3.amazonaws.com/my-backups/forge";
    passwordFile = "/etc/nixos/secrets/restic-password";
    timerConfig = {
      OnCalendar = "daily";
    };
  };
}
