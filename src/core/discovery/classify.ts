import type { PageType } from '../schemas/common.js';

/** URL/label/title heuristics. Deliberately multilingual: Danish/German/Dutch/Swedish lead-gen sites. */
const RULES: Array<{ type: PageType; patterns: RegExp }> = [
  { type: 'pricing', patterns: /(pricing|prices|priser|plans|pakker|tarife|preise|abonnement|packages)/i },
  { type: 'contact', patterns: /(contact|kontakt|get-in-touch|reach-us|contacto)/i },
  { type: 'demo_booking', patterns: /(demo|book|booking|schedule|meeting|consultation|kalender|moede|m%C3%B8de)/i },
  { type: 'case_studies', patterns: /(case|cases|customers|clients|kunder|success|referenc|testimonial|portfolio|work)/i },
  { type: 'about', patterns: /(about|om-os|about-us|team|company|virksomhed|ueber|over-ons)/i },
  { type: 'solutions', patterns: /(solution|loesning|l%C3%B8sning|platform|features|funktion|product)/i },
  { type: 'industries', patterns: /(industr|branche|sector|segment|vertical)/i },
  { type: 'product_service', patterns: /(service|services|ydelser|what-we-do|offering|leistungen|diensten)/i },
  { type: 'blog', patterns: /(blog|news|nyheder|article|insight|guide|resources|viden|artikel|press)/i },
  { type: 'legal', patterns: /(privacy|terms|cookie|gdpr|legal|handelsbetingelser|impressum|persondata|vilkaar)/i },
];

/** Never worth a page slot regardless of ranking. */
const EXCLUDED = /(\/tag\/|\/category\/|\/author\/|\/search|\/login|\/signin|\/cart|\/checkout|\/account|\/wp-admin|\/feed|\.pdf$|\.jpg$|\.png$|\.zip$|\/page\/\d+)/i;

export function isExcludedUrl(url: string): boolean {
  return EXCLUDED.test(url);
}

export function classifyPageType(url: string, label?: string, title?: string): PageType {
  const haystack = `${new URL(url).pathname} ${label ?? ''} ${title ?? ''}`;
  const path = new URL(url).pathname.replace(/\/$/, '');
  if (path === '' || path === '/') return 'homepage';
  for (const rule of RULES) if (rule.patterns.test(haystack)) return rule.type;
  return 'other';
}
