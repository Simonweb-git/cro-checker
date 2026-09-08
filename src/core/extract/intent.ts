import type { ConversionAction } from '../schemas/evidence.js';

type Intent = ConversionAction['intent'];

/** Deterministic label/destination → intent mapping. No model involvement (build spec §10). */
const INTENT_RULES: Array<[Intent, RegExp]> = [
  ['demo', /(demo|se produktet|watch.*demo|book.*demo|request.*demo)/i],
  ['booking', /(book|reserver|schedule|appointment|bestil tid|book.*m(o|ø)de|calendly)/i],
  ['call', /(call|ring|telefon|tel:|phone|talk to)/i],
  ['quote', /(quote|tilbud|pris.*tilbud|estimate|proposal|offerte|angebot)/i],
  ['trial', /(trial|pr(o|ø)v|try (it )?free|free trial|test gratis)/i],
  ['signup', /(sign ?up|get started|kom i gang|create account|opret|register|tilmeld)/i],
  ['contact', /(contact|kontakt|get in touch|skriv til os|mailto:|write to us|contacto)/i],
  ['download', /(download|hent|guide|whitepaper|e-?bog|ebook|pdf|checklist)/i],
];

export function classifyIntent(label: string, href?: string): Intent {
  const haystack = `${label} ${href ?? ''}`;
  for (const [intent, pattern] of INTENT_RULES) if (pattern.test(haystack)) return intent;
  if (href && /^https?:|^\//.test(href)) return 'navigate';
  return 'unknown';
}

/** Which action intents actually satisfy a given primary conversion goal. Used by scoring penalties. */
export const GOAL_SATISFYING_INTENTS: Record<string, Intent[]> = {
  book_demo: ['demo', 'booking', 'contact'],
  request_quote: ['quote', 'contact', 'call'],
  contact: ['contact', 'call', 'booking'],
  start_trial: ['trial', 'signup'],
  create_account: ['signup', 'trial'],
  schedule_call: ['booking', 'call', 'contact'],
  visit_location: ['contact', 'call'],
  other: ['contact', 'demo', 'quote', 'booking', 'signup', 'trial', 'call'],
};
