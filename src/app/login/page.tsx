import Link from "next/link";
import { signIn, signUp } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; error?: string; checkEmail?: string }>;
}) {
  const { mode, error, checkEmail } = await searchParams;
  const isSignup = mode === "signup";

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

        {checkEmail && (
          <p className="mb-4 rounded-md border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
            Check your email to confirm your account, then sign in below.
          </p>
        )}
        {error && (
          <p className="mb-4 rounded-md border border-hairline-strong bg-surface px-4 py-3 text-sm text-ink">
            {error}
          </p>
        )}

        <form action={isSignup ? signUp : signIn} className="space-y-4">
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
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              placeholder={isSignup ? "At least 6 characters" : "••••••••"}
              autoComplete={isSignup ? "new-password" : "current-password"}
            />
          </div>
          <Button type="submit" className="w-full">
            {isSignup ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-ink-muted">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-ink hover:underline">
                Sign in
              </Link>
            </>
          ) : (
            <>
              Need an account?{" "}
              <Link
                href="/login?mode=signup"
                className="font-medium text-ink hover:underline"
              >
                Create one
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
