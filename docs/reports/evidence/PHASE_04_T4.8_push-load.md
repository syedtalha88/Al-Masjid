# PHASE_04 T4.8 — push fan-out load test

Run: 2026-11-08T07:21:49.351Z (`pnpm load:push`). The worker runs in its own process (`scripts/load/push-worker.ts`, the production worker runtime); push service stand-in: 50–300 ms per request, 0.5 % 410. Every send is a real aes128gcm encryption + VAPID signature; the stand-in replaces only the HTTPS request.

| Measure | Value | Check |
|---|---|---|
| Devices following the masjid | 50000 |  |
| Job status | completed | PASS |
| Targeted / sent / failed / pruned | 50000 / 49753 / 0 / 247 |  |
| Total dispatch time (enqueue → completed) | 57.3 s | PASS (< 3 min) |
| Fan-out job | 2.0 s |  |
| Send batches | 200 |  |
| Batch duration p50 / p95 / max | 1.1 s / 1.8 s / 2.0 s | PASS (< 240 s timeout) |
| Worker CPU time (user + system, worker process only) | 26.7 s | PASS (< 43 s = 0.75 CPU × run time) |
| Worker RSS idle (after start-up) | 163 MB |  |
| Worker peak RSS / peak heap (worker process only) | 409 MB / 228 MB | PASS (< 512 MB) |
| Redis used memory (peak) | 12.84M |  |
| MongoDB ops (query / insert / update / command) | 1389 / 0 / 1158 / 344 |  |
| Push requests made | 50000 |  |
| Seeding time (this process, not measured above) | 4.5 s |  |
| Machine | 12 CPUs, 16107 MB RAM, Node v24.15.0 | local Docker MongoDB + Redis |

## Scaling check — 100,000 devices (`LOAD_DEVICES=100000 pnpm load:push`, same machine, 8 Nov 2026)

| Measure | 50,000 | 100,000 |
|---|---|---|
| Total dispatch time | 57.3 s | 112.4 s (< 3 min) |
| Send batches | 200 | 400 |
| Worker CPU time | 26.7 s | 50.6 s (< 0.75 CPU) |
| Worker peak RSS / heap | 409 MB / 228 MB | 404 MB / 238 MB |

Time and CPU grow linearly with the audience; the worker's memory does not — it is bounded by the batches in flight
(send-batch concurrency × 250 subscriptions), so the 512 MB container limit holds for any masjid size. The idle RSS
(163 MB) is Node's type-stripping of the TypeScript sources; the production image runs the bundled JS.
