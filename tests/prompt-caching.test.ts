import { describe, expect, it } from 'vitest';
import { buildPrompt, buildProviderOptions } from '../src/core/ai/vercel-client.js';

describe('buildPrompt (Anthropic prompt caching)', () => {
  it('marks cacheableContext as an ephemeral cache breakpoint for a Claude model', () => {
    const result = buildPrompt(
      { system: 's', prompt: 'task instructions', cacheableContext: 'big evidence block', stage: 'x' },
      'claude-sonnet-5',
    );
    expect(Array.isArray(result)).toBe(true);
    const messages = result as any[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    const [evidencePart, taskPart] = messages[0].content;
    expect(evidencePart.type).toBe('text');
    expect(evidencePart.text).toBe('big evidence block');
    expect(evidencePart.providerOptions.anthropic.cacheControl).toEqual({ type: 'ephemeral' });
    expect(taskPart.text).toBe('task instructions');
    // The task-specific part must NOT be cache-tagged — only the stable, repeated block is.
    expect(taskPart.providerOptions).toBeUndefined();
  });

  it('places the cacheable block strictly before the task-specific text', () => {
    const result = buildPrompt(
      { system: 's', prompt: 'task', cacheableContext: 'evidence', stage: 'x' },
      'claude-opus-5',
    ) as any[];
    const parts = result[0].content;
    expect(parts[0].text).toBe('evidence');
    expect(parts[1].text).toBe('task');
  });

  it('falls back to a plain string for a non-Claude model, concatenated in order', () => {
    const result = buildPrompt(
      { system: 's', prompt: 'task instructions', cacheableContext: 'evidence block', stage: 'x' },
      'gpt-5-mini',
    );
    expect(typeof result).toBe('string');
    expect(result as string).toBe('evidence block\n\ntask instructions');
  });

  it('returns a plain prompt string unchanged when there is nothing to cache', () => {
    expect(buildPrompt({ system: 's', prompt: 'just this', stage: 'x' }, 'claude-sonnet-5')).toBe('just this');
    expect(buildPrompt({ system: 's', prompt: 'just this', stage: 'x' }, 'gpt-5-mini')).toBe('just this');
  });
});

describe('buildProviderOptions (OpenAI reasoning effort/verbosity)', () => {
  it('passes reasoningEffort and textVerbosity through for an OpenAI model', () => {
    const result = buildProviderOptions(
      { system: 's', prompt: 'p', stage: 'x', reasoningEffort: 'low', textVerbosity: 'low' },
      'gpt-5-mini',
    );
    expect(result).toEqual({ openai: { reasoningEffort: 'low', textVerbosity: 'low' } });
  });

  it('passes only the fields that were actually set', () => {
    expect(buildProviderOptions({ system: 's', prompt: 'p', stage: 'x', reasoningEffort: 'low' }, 'gpt-5')).toEqual({
      openai: { reasoningEffort: 'low' },
    });
    expect(buildProviderOptions({ system: 's', prompt: 'p', stage: 'x', textVerbosity: 'high' }, 'gpt-5')).toEqual({
      openai: { textVerbosity: 'high' },
    });
  });

  it('is a no-op for a Claude model even when the fields are set', () => {
    const result = buildProviderOptions(
      { system: 's', prompt: 'p', stage: 'x', reasoningEffort: 'low', textVerbosity: 'low' },
      'claude-sonnet-5',
    );
    expect(result).toBeUndefined();
  });

  it('is a no-op when neither field is set, regardless of model', () => {
    expect(buildProviderOptions({ system: 's', prompt: 'p', stage: 'x' }, 'gpt-5-mini')).toBeUndefined();
    expect(buildProviderOptions({ system: 's', prompt: 'p', stage: 'x' }, 'claude-sonnet-5')).toBeUndefined();
  });
});
