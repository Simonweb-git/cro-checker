import type { CheerioAPI } from 'cheerio';

/**
 * Removes executable content and content that a visitor cannot see, before any text reaches an LLM
 * (build spec §8). Hidden text is the classic prompt-injection carrier.
 */
export function stripNonVisible($: CheerioAPI): void {
  $('script, style, noscript, template, iframe, svg, object, embed').remove();
  $('[hidden], [aria-hidden="true"]').remove();
  $('[style]').each((_, el) => {
    const style = ($(el).attr('style') ?? '').replace(/\s+/g, '').toLowerCase();
    if (
      style.includes('display:none') ||
      style.includes('visibility:hidden') ||
      /font-size:0(px|em|rem)?/.test(style) ||
      /opacity:0(\.0+)?[;"']?$/.test(style)
    ) {
      $(el).remove();
    }
  });
  // Common visually-hidden utility classes.
  $('.sr-only, .screen-reader-text, .visually-hidden, .hidden, .d-none').remove();
  $('*')
    .contents()
    .filter((_, node) => node.type === 'comment')
    .remove();
}

/** Collapse whitespace and cap length; scraped text is data and must never be unbounded. */
export function cleanText(input: string | undefined | null, maxLength = 400): string {
  if (!input) return '';
  return input.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
