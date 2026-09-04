"use client";

import { createAuthClient } from "better-auth/react";

/**
 * The browser client.
 *
 * No baseURL: same-origin requests to `/api/auth/*` are what we want, and
 * hardcoding an origin here is how a preview deployment ends up posting
 * credentials at production.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
