import { createAuthClient } from "better-auth/react";

// Generic OIDC providers are registered as social providers server-side
// (better-auth ≥ 1.7), so every OAuth2 button goes through signIn.social.
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
