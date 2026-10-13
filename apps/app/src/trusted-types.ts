// Evaluated first (imported before anything else in main.tsx): the Trusted Types default policy must exist
// before any code can reach a DOM sink (04 §7, T0.5).
import { installTrustedTypes } from '@mc/ui/security';

installTrustedTypes({ dev: import.meta.env.DEV });
