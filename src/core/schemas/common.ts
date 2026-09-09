import { z } from 'zod';

/**
 * A live failure showed a model occasionally emits an array-typed tool argument as a JSON-encoded
 * STRING instead of a native array (`"assessments": "[{...}]"` instead of `"assessments": [{...}]`).
 * The type is otherwise valid JSON, just double-serialized. Rather than losing the whole batch to a
 * type mismatch, this parses a string value before the array schema runs, matching wherever a model
 * generation schema has an array field.
 */
function parseIfStringified(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value; // let the array schema produce the real validation error
  }
}

/**
 * Wraps an already-built array schema (so `.min()`/`.max()` can still be chained on it beforehand)
 * with the string-parsing preprocessor above.
 */
export function lenientArray<T extends z.ZodTypeAny>(
  arraySchema: T,
): z.ZodEffects<T> {
  return z.preprocess(parseIfStringified, arraySchema) as unknown as z.ZodEffects<T>;
}

/**
 * Version stamps recorded on every analysis (build spec §15).
 * Without these, regression tests and rubric calibration are not interpretable.
 */
export const VERSIONS = {
  extractorVersion: 'ext-v1',
  promptVersion: 'prompt-v1',
  scoringVersion: 'croh-v1',
  reportSchemaVersion: 'report-v1',
} as const;

export const VersionStamp = z.object({
  extractorVersion: z.string(),
  promptVersion: z.string(),
  scoringVersion: z.string(),
  modelConfigVersion: z.string(),
  reportSchemaVersion: z.string(),
});
export type VersionStamp = z.infer<typeof VersionStamp>;

export const Confidence = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof Confidence>;

/**
 * Stable citation id for an extracted element, e.g. `page_2.hero.cta_1`.
 * Findings cite these instead of repeating page dumps (build spec §10).
 */
/**
 * Shape check only — NOT the security boundary. A live failure showed a model citing
 * "page_1.metaDescription" (a real payload field, but a bare string with no minted ref of its own):
 * the regex rejected the capital D outright before the ref even reached the registry-membership
 * check. Widened to accept mixed-case path segments. Whether a ref actually corresponds to a minted
 * evidence item is enforced separately by buildRefRegistry/checkRefs (ai/evidence-payload.ts,
 * ai/ref-validation.ts) — this regex only stops generation from being rejected for CASE.
 */
export const EvidenceRef = z.string().regex(/^page_\d+(\.[a-zA-Z0-9_]+)+$/);
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const PageId = z.string().regex(/^page_\d+$/);
export type PageId = z.infer<typeof PageId>;

/** The bounded scale an LLM may use. It may never emit a 0-100 number (ADR-003). */
export const SignalValue = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal('not_applicable'),
  z.literal('insufficient_evidence'),
]);
export type SignalValue = z.infer<typeof SignalValue>;

export const Severity = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export type Severity = z.infer<typeof Severity>;

export const ExpectedImpact = z.enum(['High', 'Medium', 'Low']);
export type ExpectedImpact = z.infer<typeof ExpectedImpact>;

export const SiteArchetype = z.enum([
  'b2b_saas',
  'professional_services',
  'agency_advisory',
  'local_leadgen',
  'other_supported',
  'ecommerce_unsupported',
  'unknown',
]);
export type SiteArchetype = z.infer<typeof SiteArchetype>;

export const ConversionGoal = z.enum([
  'book_demo',
  'request_quote',
  'contact',
  'start_trial',
  'create_account',
  'schedule_call',
  'visit_location',
  'other',
]);
export type ConversionGoal = z.infer<typeof ConversionGoal>;

export const PageType = z.enum([
  'homepage',
  'product_service',
  'pricing',
  'about',
  'contact',
  'case_studies',
  'solutions',
  'industries',
  'demo_booking',
  'blog',
  'legal',
  'other',
]);
export type PageType = z.infer<typeof PageType>;
