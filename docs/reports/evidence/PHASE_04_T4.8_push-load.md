# PHASE_04 T4.8 — push fan-out load test

Run: 2026-11-08T02:52:36.269Z (`pnpm load:push`). Receiver: in-process mock, 50–300 ms per request, 0.5 % 410. Every send is a real aes128gcm encryption + VAPID signature.

| Measure | Value | Check |
|---|---|---|
| Devices following the masjid | 50000 |  |
| Job status | completed | PASS |
| Targeted / sent / failed / pruned | 50000 / 49755 / 0 / 245 |  |
| Total dispatch time (enqueue → completed) | 57.5 s | PASS (< 3 min) |
| Fan-out job | 2.0 s |  |
| Send batches | 200 |  |
| Batch duration p50 / p95 / max | 1.2 s / 1.8 s / 2.0 s | PASS (< 240 s timeout) |
| Worker CPU time (user + system) | 27.0 s | PASS (< 43 s = 0.75 CPU × run time) |
| Worker peak RSS | 472 MB | PASS (< 512 MB) |
| Redis used memory (peak) | 12.79M |  |
| MongoDB ops (query / insert / update / command) | 1394 / 0 / 1112 / 339 |  |
| Push requests made | 50000 |  |
| Seeding time (not measured above) | 5.5 s |  |
| Machine | 12 CPUs, 16107 MB RAM, Node v24.15.0 | local Docker MongoDB + Redis |
