import { describe, it, expect } from 'vitest';
import { health, PACKAGE_NAME } from './index.js';

describe('package smoke', () => {
  it('exports name and health', () => {
    expect(PACKAGE_NAME).toBe('websearch-router');
    expect(health()).toBe('ok');
  });
});
