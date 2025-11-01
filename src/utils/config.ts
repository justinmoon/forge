import type { ForgeConfig } from '../types';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export function getConfig(): ForgeConfig {
  const dataDir = process.env.FORGE_DATA_DIR || '/var/lib/forge';
  const port = parseInt(process.env.FORGE_PORT || '3030', 10);
  const mergePassword = process.env.FORGE_MERGE_PASSWORD;
  if (!mergePassword) {
    throw new Error(
      'FORGE_MERGE_PASSWORD environment variable must be set. ' +
      'Merges are disabled without a password for security reasons.'
    );
  }

  const reposPath = join(dataDir, 'repos');
  const logsPath = join(dataDir, 'logs');
  const dbPath = join(dataDir, 'forge.db');
  const workPath = join(dataDir, 'work');
  const domain = process.env.FORGE_DOMAIN;

  return {
    dataDir,
    port,
    mergePassword,
    reposPath,
    logsPath,
    dbPath,
    workPath,
    domain,
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
