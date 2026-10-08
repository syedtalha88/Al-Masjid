import { noAdhocMotion } from './no-adhoc-motion.js';
import { noPhysicalDirection } from './no-physical-direction.js';
import { noRawRoutes } from './no-raw-routes.js';

/** Project-specific lint rules (prefix `mc/`). */
export const mcPlugin = {
  meta: { name: 'eslint-plugin-mc', version: '0.0.0' },
  rules: {
    'no-adhoc-motion': noAdhocMotion,
    'no-physical-direction': noPhysicalDirection,
    'no-raw-routes': noRawRoutes,
  },
};
