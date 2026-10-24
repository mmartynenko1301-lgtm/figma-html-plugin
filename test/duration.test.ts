import { describe, expect, it } from 'vitest';
import { NETWORKS, effectiveDuration, validate } from '../src/core/networks';
import { parseSettings } from '../src/shared/anim';

describe('banner duration', () => {
  it('falls back to the network limit', () => {
    expect(effectiveDuration(NETWORKS['google-ads'], null)).toBe(30);
    expect(effectiveDuration(NETWORKS['google-ads'], 15)).toBe(15);
    expect(effectiveDuration(NETWORKS.none, null)).toBeNull();
  });

  it('reads a stored duration and ignores bad values', () => {
    const base = { v: 1, clickTag: 'x', network: 'iab', backup: false, optimize: true };
    expect(parseSettings(JSON.stringify({ ...base, duration: 12 })).duration).toBe(12);
    expect(parseSettings(JSON.stringify({ ...base, duration: -3 })).duration).toBeNull();
    expect(parseSettings(JSON.stringify(base)).duration).toBeNull();
  });

  it('reports an animation longer than the network allows', () => {
    const input = { width: 300, height: 250, zipBytes: 1000, fileCount: 2 };
    expect(validate(NETWORKS.iab, { ...input, duration: 20 })).toEqual([]);
    expect(validate(NETWORKS.iab, { ...input, duration: 45 })).toHaveLength(1);
    expect(validate(NETWORKS.iab, { ...input, duration: 'infinite' })).toHaveLength(1);
    expect(validate(NETWORKS.none, { ...input, duration: 'infinite' })).toEqual([]);
  });
});
