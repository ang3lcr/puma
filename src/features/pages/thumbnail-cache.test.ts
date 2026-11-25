import { describe, expect, it, vi } from 'vitest';
import { ByteLruCache } from './thumbnail-cache';

describe('ByteLruCache', () => {
  it('evicts the least recently used values to stay within its byte limit', () => {
    const dispose = vi.fn();
    const cache = new ByteLruCache<string, string>(10, (value) => value.length, dispose);

    cache.set('first', '123456');
    cache.set('second', '1234');
    expect(cache.get('first')).toBe('123456');
    cache.set('third', '5678');

    expect(cache.get('first')).toBe('123456');
    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('third')).toBe('5678');
    expect(cache.bytesUsed).toBe(10);
    expect(dispose).toHaveBeenCalledWith('1234');
  });

  it('disposes oversized values and releases all entries on clear', () => {
    const dispose = vi.fn();
    const cache = new ByteLruCache<string, string>(4, (value) => value.length, dispose);

    cache.set('large', '12345');
    expect(cache.size).toBe(0);
    expect(dispose).toHaveBeenCalledWith('12345');

    cache.set('small', '1234');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytesUsed).toBe(0);
    expect(dispose).toHaveBeenCalledWith('1234');
  });
});
