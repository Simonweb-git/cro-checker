import type { CrawlBudget } from './crawl/types.js';

/** All tunables are configuration, never literals in business logic (build spec §1, ADR-004). */
export interface EngineConfig {
  models: {
    siteContext: string;
    signals: string;
    diagnostic: string;
    fix: string;
    qa: string;
    modelConfigVersion: string;
  };
  keys: { anthropic?: string; openai?: string; gateway?: string };
  crawl: CrawlBudget & { adapter: 'static' | 'playwright'; maxCandidates: number; maxPages: number; respectRobots: boolean };
  performance: { adapter: 'none' | 'psi'; apiKey?: string; timeoutMs: number };
  budgets: { maxDurationMs: number; maxModelCalls: number; maxTokens: number };
  reportLanguage: string | null;
  persistence: 'memory' | 'postgres';
  databaseUrl?: string;
  nodeEnv: string;
}

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * `??` only falls back on null/undefined, not on an empty string — and an env var that exists but
 * was saved with no value (as happened live: several MODEL_* vars were added in the Vercel dashboard
 * with a blank value) reads back as `""`, not undefined. That silently produced an empty model name
 * instead of the documented default. Every string env default goes through this instead.
 */
const str = (value: string | undefined, fallback: string): string => (value ? value : fallback);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  return {
    models: {
      siteContext: str(env.MODEL_SITECONTEXT, 'claude-sonnet-5'),
      signals: str(env.MODEL_SIGNALS, 'claude-sonnet-5'),
      diagnostic: str(env.MODEL_DIAGNOSTIC, 'claude-opus-5'),
      fix: str(env.MODEL_FIX, 'claude-opus-5'),
      qa: str(env.MODEL_QA, 'gpt-5'),
      modelConfigVersion: str(env.MODEL_CONFIG_VERSION, 'mc-v1'),
    },
    keys: {
      anthropic: env.ANTHROPIC_API_KEY || undefined,
      openai: env.OPENAI_API_KEY || undefined,
      gateway: env.AI_GATEWAY_API_KEY || undefined,
    },
    crawl: {
      adapter: env.CRAWL_ADAPTER === 'playwright' ? 'playwright' : 'static',
      maxCandidates: num(env.CRAWL_MAX_CANDIDATES, 40),
      maxPages: Math.min(num(env.CRAWL_MAX_PAGES, 5), 5), // hard product maximum
      maxRedirects: num(env.CRAWL_MAX_REDIRECTS, 3),
      maxBytes: num(env.CRAWL_MAX_BYTES, 2_500_000),
      maxRequests: num(env.CRAWL_MAX_REQUESTS, 45),
      timeoutMs: num(env.CRAWL_TIMEOUT_MS, 15_000),
      userAgent: str(env.CRAWL_USER_AGENT, 'CROCheckerBot/0.1'),
      respectRobots: env.CRAWL_RESPECT_ROBOTS !== 'false',
    },
    performance: {
      adapter: env.PERFORMANCE_ADAPTER === 'psi' ? 'psi' : 'none',
      apiKey: env.PAGESPEED_API_KEY || undefined,
      timeoutMs: num(env.PERFORMANCE_TIMEOUT_MS, 25_000),
    },
    budgets: {
      maxDurationMs: num(env.ANALYSIS_MAX_DURATION_MS, 300_000),
      maxModelCalls: num(env.ANALYSIS_MAX_MODEL_CALLS, 24),
      maxTokens: num(env.ANALYSIS_MAX_TOKENS, 250_000),
    },
    reportLanguage: env.REPORT_LANGUAGE || null,
    persistence: env.PERSISTENCE === 'postgres' ? 'postgres' : 'memory',
    databaseUrl: resolveDatabaseUrl(env),
    nodeEnv: str(env.NODE_ENV, 'development'),
  };
}

/**
 * Vercel's own Postgres integrations (Neon-backed "Storage" tab, or the older Vercel Postgres
 * product) don't all inject the same env var name — DATABASE_URL is the portable one we document,
 * but POSTGRES_URL / POSTGRES_PRISMA_URL show up depending on which integration was used. Checking
 * the common names here means "connect a Postgres database in the Vercel dashboard" just works,
 * without asking the user to rename an env var (ADR-011: adapters stay portable, not vendor-coupled).
 */
function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  return (
    env.DATABASE_URL ||
    env.POSTGRES_URL ||
    env.POSTGRES_PRISMA_URL ||
    env.POSTGRES_URL_NON_POOLING ||
    undefined
  );
}

export function hasRealModelAccess(config: EngineConfig): boolean {
  return Boolean(config.keys.anthropic || config.keys.openai || config.keys.gateway);
}
