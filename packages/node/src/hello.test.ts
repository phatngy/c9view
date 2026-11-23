import { expect, it } from 'vitest';
import { createNodeHello } from './hello.js';

it('T117 hello reports sdkAuth next to the control state', () => {
  const hello = createNodeHello({
    capability: { state: 'ready', bypass: false, sdkAuth: 'api-key-required' },
  });
  expect(hello.capabilities.control).toEqual({
    state: 'ready',
    sdkAuth: 'api-key-required',
  });
  expect(createNodeHello().capabilities.control).toEqual({ state: 'off' });
});
