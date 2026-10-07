import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { lenientArray } from '../src/core/schemas/common.js';
import { SignalBatchOutput } from '../src/core/schemas/signals.js';

describe('lenientArray', () => {
  const schema = z.object({ items: lenientArray(z.array(z.number()).min(1)) });

  it('accepts a native array unchanged', () => {
    expect(schema.parse({ items: [1, 2, 3] })).toEqual({ items: [1, 2, 3] });
  });

  it('parses a JSON-encoded string array (the live failure shape)', () => {
    expect(schema.parse({ items: '[1,2,3]' })).toEqual({ items: [1, 2, 3] });
  });

  it('still enforces chained constraints (.min()) after parsing a string', () => {
    expect(() => schema.parse({ items: '[]' })).toThrow();
  });

  it('produces a real validation error for a non-JSON string, not a silent pass', () => {
    expect(() => schema.parse({ items: 'not json' })).toThrow();
  });

  it('recovers a complete array with one stray trailing character (live failure shape)', () => {
    // The model duplicated the outer object's closing brace into the string:
    // `{"assessments": "[...]}" }` — a complete, valid array followed by one extra `}`.
    expect(schema.parse({ items: '[1,2,3]}' })).toEqual({ items: [1, 2, 3] });
  });

  it('recovers the valid array prefix even when more trails after the stray character', () => {
    // Whatever comes after the array's real closing bracket is discarded, not guessed at.
    expect(schema.parse({ items: '[1,2,3]}{"extra":"object"}' })).toEqual({ items: [1, 2, 3] });
  });

  it('does not recover a genuinely incomplete array (missing closing bracket entirely)', () => {
    expect(() => schema.parse({ items: '[1,2,3' })).toThrow();
  });

  it('still finds the real closing bracket when content contains "]" earlier in the string', () => {
    const withBracketInContent = z.object({
      items: lenientArray(z.array(z.object({ note: z.string() }))),
    });
    // lastIndexOf finds the array's actual closing bracket (the last one), not the one embedded in
    // the note text, so recovery still lands on the correct, complete substring either way.
    expect(withBracketInContent.parse({ items: '[{"note":"see item [2]"}]x' })).toEqual({
      items: [{ note: 'see item [2]' }],
    });
    expect(withBracketInContent.parse({ items: '[{"note":"see item [2]"}]' })).toEqual({
      items: [{ note: 'see item [2]' }],
    });
  });

  it('wraps a bare stringified object as a one-item array (live failure shape)', () => {
    // For a single-signal category, the model wrote the one object directly as the string's
    // content, forgetting the array brackets entirely: `"assessments": "{...}"`.
    const withObject = z.object({ items: lenientArray(z.array(z.object({ a: z.number() }))) });
    expect(withObject.parse({ items: '{"a":1}' })).toEqual({ items: [{ a: 1 }] });
  });

  it('unwraps a redundant single-key wrapper around the real array (live failure shape)', () => {
    // The model re-nested the whole outer object one level too deep inside the string:
    // `"items": "{\"items\": [...]}"` instead of just `"items": "[...]"`.
    expect(schema.parse({ items: '{"items":[1,2,3]}' })).toEqual({ items: [1, 2, 3] });
    // Generic by shape, not by field name — an unrelated key name unwraps the same way.
    expect(schema.parse({ items: '{"whatever":[1,2,3]}' })).toEqual({ items: [1, 2, 3] });
  });

  it('does not wrap a bare stringified array element incorrectly (still a real array, not double-wrapped)', () => {
    expect(schema.parse({ items: '[1,2,3]' })).toEqual({ items: [1, 2, 3] });
  });
});

describe('SignalBatchOutput accepts the exact live failure shape', () => {
  it('parses when the model double-serializes the assessments array', () => {
    const stringified = JSON.stringify([
      {
        signalId: 'path_comprehensibility',
        value: 2,
        evidenceRefs: ['page_1.header.nav_1'],
        confidence: 'high',
        rationale: 'ok',
      },
    ]);
    const result = SignalBatchOutput.parse({ assessments: stringified });
    expect(result.assessments).toHaveLength(1);
    expect(result.assessments[0]!.signalId).toBe('path_comprehensibility');
  });

  it('also parses a double-serialized evidenceRefs array inside a native assessments array', () => {
    const result = SignalBatchOutput.parse({
      assessments: [
        {
          signalId: 'offer_clarity',
          value: 3,
          evidenceRefs: '["page_1.hero.headline","page_1.section_1"]',
          confidence: 'high',
          rationale: 'ok',
        },
      ],
    });
    expect(result.assessments[0]!.evidenceRefs).toEqual(['page_1.hero.headline', 'page_1.section_1']);
  });

  it('parses when a single-signal category writes a bare object instead of a one-item array', () => {
    const bareObject = JSON.stringify({
      signalId: 'buyer_compatibility',
      value: 4,
      evidenceRefs: ['page_1.hero.headline'],
      confidence: 'high',
      rationale: 'ok',
    });
    const result = SignalBatchOutput.parse({ assessments: bareObject });
    expect(result.assessments).toHaveLength(1);
    expect(result.assessments[0]!.signalId).toBe('buyer_compatibility');
  });

  it('parses when the model re-nests the whole outer object inside the string (live failure shape)', () => {
    const renested = JSON.stringify({
      assessments: [
        {
          signalId: 'proof_at_commitment_stages',
          value: 2,
          evidenceRefs: ['page_1.trust.testimonial_1'],
          confidence: 'medium',
          rationale: 'ok',
        },
      ],
    });
    const result = SignalBatchOutput.parse({ assessments: renested });
    expect(result.assessments).toHaveLength(1);
    expect(result.assessments[0]!.signalId).toBe('proof_at_commitment_stages');
  });
});
