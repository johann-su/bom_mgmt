"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { signIn } from "@/lib/auth-client";
import type { OAuthProvider } from "@/lib/auth-config";
import { APP_NAME } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SignInForm({
  oauthProviders,
  passwordLoginEnabled,
  signupEnabled,
  callbackPath,
}: {
  oauthProviders: OAuthProvider[];
  // DISABLE_PASSWORD_LOGIN instances offer OAuth only — hiding the fields is
  // cosmetic, BetterAuth stops serving the email sign-in endpoint either way.
  passwordLoginEnabled: boolean;
  signupEnabled: boolean;
  // Server-validated in-app path to land on after login (null → dashboard).
  callbackPath: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState<string | null>(null);
  const destination = callbackPath ?? "/";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    const { error } = await signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Sign in failed");
      return;
    }
    router.push(destination);
    router.refresh();
  }

  async function handleOAuth(provider: OAuthProvider) {
    setRedirecting(provider.id);
    const { error } = await signIn.social({ provider: provider.id, callbackURL: destination });
    // On success the browser is redirected to the provider.
    if (error) {
      setRedirecting(null);
      toast.error(error.message ?? `${provider.name} sign in failed`);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Welcome back to {APP_NAME}.</CardDescription>
        </CardHeader>
        <CardContent>
          {passwordLoginEnabled && (
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
              {signupEnabled && (
                <p className="text-sm text-muted-foreground text-center">
                  No account?{" "}
                  <Link
                    href={
                      callbackPath
                        ? `/sign-up?callbackUrl=${encodeURIComponent(callbackPath)}`
                        : "/sign-up"
                    }
                    className="underline"
                  >
                    Sign up
                  </Link>
                </p>
              )}
            </form>
          )}

          {oauthProviders.length > 0 && (
            <>
              {/* The divider only separates two options — with OAuth alone
                  the buttons stand by themselves. */}
              {passwordLoginEnabled && (
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                {oauthProviders.map((provider) => (
                  <Button
                    key={provider.id}
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={redirecting !== null}
                    onClick={() => handleOAuth(provider)}
                  >
                    <KeyRound className="size-4" />
                    {redirecting === provider.id ? "Redirecting…" : `Continue with ${provider.name}`}
                  </Button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
