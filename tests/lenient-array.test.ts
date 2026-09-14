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
});
