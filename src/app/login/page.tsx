import { signInWithEmail } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

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

        {sent ? (
          <p className="rounded-md border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
            Check your email for a sign-in link.
          </p>
        ) : (
          <form action={signInWithEmail} className="space-y-4">
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
              Send sign-in link
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
