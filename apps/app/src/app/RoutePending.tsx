/** Suspense/pending fallback for route loads. Replaced by per-screen skeletons in T0.10 (06 §6 Skeleton). */
export function RoutePending() {
  return <div aria-busy="true" />;
}
