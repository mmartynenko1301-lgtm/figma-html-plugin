import { describe, expect, it } from 'vitest';
import { NETWORKS, validate } from '../src/core/networks';

describe('validate', () => {
  it('passes a banner within Google Ads limits', () => {
    expect(validate(NETWORKS['google-ads'], { width: 300, height: 250, zipBytes: 120_000, fileCount: 5 })).toEqual([]);
  });

  it('reports weight, file count and size problems', () => {
    const problems = validate(NETWORKS['google-ads'], { width: 250, height: 300, zipBytes: 700 * 1024, fileCount: 41 });
    expect(problems).toHaveLength(3);
  });

  it('accepts anything without a network', () => {
    expect(validate(NETWORKS.none, { width: 1, height: 1, zipBytes: 1e9, fileCount: 999 })).toEqual([]);
  });
});
