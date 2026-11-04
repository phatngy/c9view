import { expect, it } from 'vitest';
import { createNodeHello } from '../hello.js';
import { setupControl } from './test-support.js';
it('T017 T034 reports ready, bypass and unavailable from the running service', async () => {
  const t = await setupControl({ bypass: true });
  try {
    const hello = createNodeHello(t.service);
    expect(hello.capabilities).toMatchObject({
      control: { state: 'ready' },
      bypass: true,
    });
    expect(structuredClone(hello).bootId).toBe(hello.bootId);
    await t.service.close();
    expect(hello.capabilities.control).toMatchObject({
      state: 'unavailable',
      reason: 'Control is closed',
    });
  } finally {
    await t.close();
  }
});
