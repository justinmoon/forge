import type { ForgeConfig } from '../types';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { npubToHex } from '../auth/nostr';

export function getConfig(): ForgeConfig {
  const dataDir = process.env.FORGE_DATA_DIR || '/var/lib/forge';
  const port = parseInt(process.env.FORGE_PORT || '3030', 10);
  
  // Parse allowed pubkeys (comma-separated npubs or hex pubkeys)
  const allowedPubkeysEnv = process.env.FORGE_ALLOWED_PUBKEYS || 'npub1zxu639qym0esxnn7rzrt48wycmfhdu3e5yvzwx7ja3t84zyc2r8qz8cx2y';
  const allowedPubkeys = allowedPubkeysEnv.split(',').map(key => {
    key = key.trim();
    if (key.startsWith('npub')) {
      return npubToHex(key);
    }
    return key;
  });

  // Check if auth should be disabled (for dev convenience)
  const disableAuth = process.env.DISABLE_AUTH === 'true';
  
  // Also disable in test mode for automated tests
  const nodeEnv = process.env.NODE_ENV || 'production';
  const isDevelopment = disableAuth || nodeEnv === 'test';

  if (isDevelopment) {
    if (disableAuth) {
      console.warn('⚠️  AUTH DISABLED: Set via DISABLE_AUTH=true. Do not use in production!');
    } else {
      console.warn('⚠️  TEST MODE: Authentication bypass is ENABLED for tests.');
    }
  }

  const reposPath = join(dataDir, 'repos');
  const logsPath = join(dataDir, 'logs');
  const dbPath = join(dataDir, 'forge.db');
  const workPath = join(dataDir, 'work');
  const domain = process.env.FORGE_DOMAIN;

  return {
    dataDir,
    port,
    allowedPubkeys,
    reposPath,
    logsPath,
    dbPath,
    workPath,
    domain,
    isDevelopment,
  };
}

export function ensureDataDirectories(config: ForgeConfig): void {
  const dirs = [
    config.dataDir,
    config.reposPath,
    config.logsPath,
    config.workPath,
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
