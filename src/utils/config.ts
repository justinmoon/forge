import type { ForgeConfig } from '../types';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { npubToHex } from '../auth/nostr';

export function getConfig(requirePassword: boolean = false): ForgeConfig {
  const dataDir = process.env.FORGE_DATA_DIR || '/var/lib/forge';
  const port = parseInt(process.env.FORGE_PORT || '3030', 10);
  
  // Parse allowed pubkeys (comma-separated npubs or hex pubkeys)
  const nodeEnv = process.env.NODE_ENV || 'production';
  const allowedPubkeysEnv = process.env.FORGE_ALLOWED_PUBKEYS || '';
  const allowedPubkeys = allowedPubkeysEnv
    .split(',')
    .map(key => key.trim())
    .filter(key => key.length > 0)
    .map(key => {
      if (key.startsWith('npub')) {
        return npubToHex(key);
      }
      return key;
    });

  // Require whitelist in production and development, allow empty in test mode
  if (allowedPubkeys.length === 0 && nodeEnv !== 'test') {
    throw new Error(
      'FORGE_ALLOWED_PUBKEYS environment variable must be set with at least one pubkey. ' +
      'Example: FORGE_ALLOWED_PUBKEYS=npub1... or hex pubkey'
    );
  }

  // Check if auth should be disabled (only in development)
  const disableAuth = process.env.DISABLE_AUTH === 'true';
  
  // Guardrail: DISABLE_AUTH only works in development
  if (disableAuth && nodeEnv !== 'development') {
    console.error('❌ SECURITY ERROR: DISABLE_AUTH=true is only allowed when NODE_ENV=development');
    process.exit(1);
  }
  
  // Auth bypass: only in test mode or when explicitly disabled in dev
  const isDevelopment = (nodeEnv === 'test') || (nodeEnv === 'development' && disableAuth);

  if (isDevelopment) {
    if (disableAuth) {
      console.warn('⚠️  AUTH DISABLED: Set via DISABLE_AUTH=true in development mode.');
    } else if (nodeEnv === 'test') {
      console.warn('⚠️  TEST MODE: Authentication bypass is ENABLED for automated tests.');
    }
  }

  const reposPath = join(dataDir, 'repos');
  const logsPath = join(dataDir, 'logs');
  const dbPath = join(dataDir, 'forge.db');
  const workPath = join(dataDir, 'work');
  const domain = process.env.FORGE_DOMAIN;
  
  // Only trust X-Forwarded-For when behind a trusted reverse proxy
  const trustProxy = process.env.FORGE_TRUST_PROXY === 'true';
  
  if (trustProxy) {
    console.log('✓ Proxy trust enabled: Using X-Forwarded-For for original client IP');
  } else {
    console.log('✓ Direct mode: Using TCP connection address for IP-based security');
  }

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
    trustProxy,
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
