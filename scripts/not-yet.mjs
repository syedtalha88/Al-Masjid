// Placeholder for root scripts whose implementation lands in a later task/phase.
// Prints a clear message instead of failing silently (PHASE_00 T0.1).
const [name = 'this script', availableFrom = 'a later phase'] = process.argv.slice(2);
process.stdout.write(
  `\n[masjid-connect] "${name}" is not implemented yet — available from ${availableFrom}. Skipping.\n\n`,
);
