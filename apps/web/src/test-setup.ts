import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });

// findBy*/waitFor default to 1 s, which loaded CI runners miss while every
// workspace package runs its tests at once. A longer ceiling only slows a
// genuinely failing test; passing tests still resolve as soon as they can.
configure({ asyncUtilTimeout: 5_000 });
