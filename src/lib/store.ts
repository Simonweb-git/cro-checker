import { Pool } from 'pg';
import { loadConfig } from '../core/config.js';
import { InMemoryRepository } from '../core/persistence/repository.js';
import { PostgresRepository, applyMigrations } from '../core/persistence/postgres.js';
import type { AnalysisRepository } from '../core/persistence/repository.js';

/**
 * Process-wide singletons for the Next.js app.
 *
 * Stashed on `globalThis` rather than a plain module-level variable: Next.js (dev mode especially,
 * via on-demand route compilation/HMR) can give each API route file its own module instance, so a
 * `let` at module scope is NOT reliably shared between e.g. POST /api/analysis and
 * GET /api/analysis/:id even within the same process — the classic Prisma-client-singleton problem.
 * `globalThis` is the one thing every module instance in the process actually shares.
 *
 * KNOWN MVP LIMITATION (tracked, not silent): a Vercel serverless deployment can run multiple
 * instances, and each gets its own `globalThis`. With PERSISTENCE=memory, state is not shared across
 * instances — fine for local dev and a single-instance deployment. Set PERSISTENCE=postgres +
 * DATABASE_URL for durable, multi-instance job/progress state (ADR-011). Moving orchestration itself
 * onto Vercel Workflows (ADR-002) is the follow-up once traffic requires surviving a function restart
 * mid-scan.
 */
const globalStore = globalThis as unknown as {
  __croCheckerRepository?: Promise<AnalysisRepository>;
};

export function getRepository(): Promise<AnalysisRepository> {
  if (!globalStore.__croCheckerRepository) {
    const config = loadConfig();
    globalStore.__croCheckerRepository =
      config.persistence === 'postgres' && config.databaseUrl
        ? (async () => {
            const pool = new Pool({ connectionString: config.databaseUrl });
            await applyMigrations(pool);
            return new PostgresRepository(pool);
          })()
        : Promise.resolve(new InMemoryRepository());
  }
  return globalStore.__croCheckerRepository;
}

export function getConfig() {
  return loadConfig();
}
