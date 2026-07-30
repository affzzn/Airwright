import { sendOtp, verifyOtp } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; email?: string; error?: string }>;
}) {
  const { step, email, error } = await searchParams;
  const onCodeStep = step === "code";

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            Airwright
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Quote &amp; Take-off Engine
          </p>
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-hairline-strong bg-surface px-4 py-3 text-sm text-ink">
            {error}
          </p>
        )}

        {onCodeStep ? (
          <form action={verifyOtp} className="space-y-4">
            <input type="hidden" name="email" value={email ?? ""} />
            <div>
              <Label htmlFor="token">Enter the 6-digit code</Label>
              <Input
                id="token"
                name="token"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="123456"
                autoFocus
              />
              <p className="mt-1.5 text-xs text-ink-subtle">
                Sent to {email}. Check your inbox.
              </p>
            </div>
            <Button type="submit" className="w-full">
              Sign in
            </Button>
            <a
              href="/login"
              className="block text-center text-xs text-ink-muted hover:text-ink"
            >
              Use a different email
            </a>
          </form>
        ) : (
          <form action={sendOtp} className="space-y-4">
            <div>
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@airwrightmidland.co.uk"
                autoComplete="email"
              />
            </div>
            <Button type="submit" className="w-full">
              Send sign-in code
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
