import { describe, it, expect } from 'vitest';
import { selectTrayImpl } from './index.js';

describe('selectTrayImpl', () => {
  it('picks the windows impl on win32, unix impl otherwise', () => {
    const impl = selectTrayImpl(process.platform);
    if (process.platform === 'win32') expect(impl.platform).toBe('win32');
    else expect(impl.platform).toBe(process.platform);
  });
});
