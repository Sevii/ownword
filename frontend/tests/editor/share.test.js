import { describe, it, expect } from 'vitest';
import { encodeShare, decodeShare, MAX_SHARE_BYTES, SHARE_PREFIX } from '../../src/site/share.js';

describe('share links (plan §5.1)', () => {
  it('round-trips title and Markdown through a compressed, URL-safe fragment', async () => {
    const doc = { title: 'Q3 plan: “draft”', markdown: '# Plan\n\nShip **bold** and ünïcödé 😀.\n\n- one\n- two\n' };
    const fragment = await encodeShare(doc);
    expect(fragment.startsWith(SHARE_PREFIX)).toBe(true);
    expect(fragment).toMatch(/^#share=[A-Za-z0-9_-]+$/u);
    expect(await decodeShare(fragment)).toEqual(doc);
  });
  it('rejects links that are too long, and garbage', async () => {
    await expect(encodeShare({ title: 't', markdown: Array.from({ length: 20000 }, (_, i) => `line ${i} ${Math.random()}`).join('\n') })).rejects.toThrow(/too long/u);
    expect(await decodeShare('#share=not-valid')).toBeNull();
    expect(await decodeShare('#other=1')).toBeNull();
    expect(await decodeShare('')).toBeNull();
    expect(MAX_SHARE_BYTES).toBe(32768);
  });
});
