// First visit in iPhone Safari from a follow link (DECISIONS #14): the follow landing with its "follow it in the app"
// explainer, before onboarding. "Use it here in Safari instead" → "Follow masjid" goes on to onboarding, which follows
// the masjid when it ends; a code that matches no masjid goes on without it.
import { FollowLanding } from './FollowLanding.tsx';

export default function IosArrival({
  code,
  onContinue,
}: {
  readonly code: string;
  readonly onContinue: (followable: boolean) => void;
}) {
  return (
    <main className="h-dvh overflow-y-auto bg-bg px-screen pt-safe pb-safe">
      <div className="mx-auto max-w-lg pt-4">
        <FollowLanding
          code={code}
          iosBrowser
          onOpen={() => {
            onContinue(true);
          }}
          onManage={() => {
            onContinue(true);
          }}
          onScan={() => {
            onContinue(false);
          }}
          onContinue={onContinue}
        />
      </div>
    </main>
  );
}
