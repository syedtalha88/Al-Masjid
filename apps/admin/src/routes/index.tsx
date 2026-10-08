import { BRAND } from '@mc/shared/brand';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

/** Empty admin Home shell (Phase 0 has no feature screens — PHASE_00 "Out of scope"). */
function Home() {
  return <h1>{BRAND.adminName}</h1>;
}
