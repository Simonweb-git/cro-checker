import type { Pool } from 'pg';
import type { AnalysisJob, JobStage } from '../schemas/job.js';
import type { FinalReport } from '../schemas/report.js';
import type { AnalysisRepository, StepRecord } from './repository.js';

/**
 * Versioned migration. Applied by `applyMigrations` at startup; no ORM, no vendor lock-in (ADR-011).
 *
 * All table names (including the migration-tracking table itself) are prefixed `cro_checker_`.
 * A live deployment connected a Neon database that already belonged to a completely different
 * project and already had its own generically-named `schema_migrations` table (different columns),
 * which made `CREATE TABLE IF NOT EXISTS schema_migrations (...)` silently no-op against the wrong
 * table and the next query fail with "column \"id\" does not exist". This app should still get its
 * own dedicated database, but the prefix means it can never again collide with another project's
 * tooling if it ends up sharing a database.
 */
export const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: '001_init',
    sql: `
      CREATE TABLE IF NOT EXISTS cro_checker_analyses (
        analysis_id TEXT PRIMARY KEY,
        root_url TEXT NOT NULL,
        stage TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        selected_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
        error TEXT,
        partial_reasons JSONB NOT NULL DEFAULT '[]'::jsonb
      );
      CREATE TABLE IF NOT EXISTS cro_checker_analysis_steps (
        analysis_id TEXT NOT NULL REFERENCES cro_checker_analyses(analysis_id) ON DELETE CASCADE,
        step TEXT NOT NULL,
        output JSONB NOT NULL,
        duration_ms INTEGER NOT NULL,
        completed_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (analysis_id, step)
      );
      CREATE TABLE IF NOT EXISTS cro_checker_analysis_reports (
        analysis_id TEXT PRIMARY KEY REFERENCES cro_checker_analyses(analysis_id) ON DELETE CASCADE,
        report JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
];

export async function applyMigrations(pool: Pool): Promise<void> {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS cro_checker_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  for (const migration of MIGRATIONS) {
    const { rowCount } = await pool.query('SELECT 1 FROM cro_checker_migrations WHERE id = $1', [migration.id]);
    if (rowCount) continue;
    await pool.query(migration.sql);
    await pool.query('INSERT INTO cro_checker_migrations (id) VALUES ($1)', [migration.id]);
  }
}

export class PostgresRepository implements AnalysisRepository {
  constructor(private readonly pool: Pool) {}

  async createJob(job: AnalysisJob): Promise<void> {
    await this.pool.query(
      `INSERT INTO cro_checker_analyses (analysis_id, root_url, stage, created_at, updated_at, selected_pages, error, partial_reasons)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (analysis_id) DO NOTHING`,
      [job.analysisId, job.rootUrl, job.stage, job.createdAt, job.updatedAt, JSON.stringify(job.selectedPages), job.error, JSON.stringify(job.partialReasons)],
    );
  }

  async getJob(analysisId: string): Promise<AnalysisJob | null> {
    const { rows } = await this.pool.query('SELECT * FROM cro_checker_analyses WHERE analysis_id = $1', [analysisId]);
    const row = rows[0];
    if (!row) return null;
    return {
      analysisId: row.analysis_id,
      rootUrl: row.root_url,
      stage: row.stage,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      selectedPages: row.selected_pages,
      error: row.error,
      partialReasons: row.partial_reasons,
    };
  }

  async updateJob(analysisId: string, patch: Partial<AnalysisJob>): Promise<void> {
    const current = await this.getJob(analysisId);
    if (!current) throw new Error(`Unknown analysis ${analysisId}`);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await this.pool.query(
      `UPDATE cro_checker_analyses SET stage=$2, updated_at=$3, selected_pages=$4, error=$5, partial_reasons=$6 WHERE analysis_id=$1`,
      [analysisId, next.stage, next.updatedAt, JSON.stringify(next.selectedPages), next.error, JSON.stringify(next.partialReasons)],
    );
  }

  async setStage(analysisId: string, stage: JobStage): Promise<void> {
    await this.updateJob(analysisId, { stage });
  }

  async saveStep(record: StepRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO cro_checker_analysis_steps (analysis_id, step, output, duration_ms, completed_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (analysis_id, step) DO UPDATE SET output=EXCLUDED.output, duration_ms=EXCLUDED.duration_ms, completed_at=EXCLUDED.completed_at`,
      [record.analysisId, record.step, JSON.stringify(record.output), record.durationMs, record.completedAt],
    );
  }

  async getStep(analysisId: string, step: string): Promise<StepRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM cro_checker_analysis_steps WHERE analysis_id=$1 AND step=$2',
      [analysisId, step],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      analysisId: row.analysis_id,
      step: row.step,
      output: row.output,
      durationMs: row.duration_ms,
      completedAt: new Date(row.completed_at).toISOString(),
    };
  }

  async saveReport(analysisId: string, report: FinalReport): Promise<void> {
    await this.pool.query(
      `INSERT INTO cro_checker_analysis_reports (analysis_id, report) VALUES ($1,$2)
       ON CONFLICT (analysis_id) DO UPDATE SET report=EXCLUDED.report`,
      [analysisId, JSON.stringify(report)],
    );
  }

  async getReport(analysisId: string): Promise<FinalReport | null> {
    const { rows } = await this.pool.query('SELECT report FROM cro_checker_analysis_reports WHERE analysis_id=$1', [analysisId]);
    return rows[0]?.report ?? null;
  }
}
