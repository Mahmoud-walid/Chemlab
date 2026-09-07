import { describe, expect, it } from "vitest";

import {
  CONFIG_TARGETS,
  configStatusFrom,
  configuredOAuthProviders,
} from "@/lib/settings/config-status-core";

const full = {
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:owner@example.test",
  SLACK_WEBHOOK_URL: "https://hooks.example/x",
  CLOUDINARY_CLOUD_NAME: "cloud",
  CLOUDINARY_API_KEY: "key",
  CLOUDINARY_API_SECRET: "secret",
  CLOUDINARY_UPLOAD_FOLDER: "production",
  RESEND_API_KEY: "re_x",
};

describe("configuration status", () => {
  it("reads the PUBLIC VAPID key under the name the app actually uses", () => {
    // This screen used to read an unprefixed `VAPID_PUBLIC_KEY`, which no code
    // path sets: `lib/push/send.ts` and the settings page both read
    // `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, because every subscribing browser needs
    // it. The screen was therefore wrong in BOTH directions — "not
    // configured" where push worked, and "configured" where it could not.
    expect(
      configStatusFrom({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:owner@example.test",
      }).webPush,
    ).toBe(true);
  });

  it("reports nothing configured for an empty environment", () => {
    const status = configStatusFrom({});
    for (const target of CONFIG_TARGETS) {
      expect(status[target], target).toBe(false);
    }
  });

  it("reports everything configured when every variable is set", () => {
    const status = configStatusFrom(full);
    for (const target of CONFIG_TARGETS) {
      expect(status[target], target).toBe(true);
    }
  });

  it("treats half a credential as not configured", () => {
    // A client id without its secret fails at the callback with an error that
    // reads like a bug in the app. Calling that "configured" sends whoever is
    // debugging it to entirely the wrong place.
    expect(configStatusFrom({ GOOGLE_CLIENT_ID: "id" }).googleOAuth).toBe(
      false,
    );
    // Cloudinary needs FOUR. Three of them without the upload folder is an
    // account the server can reach and no environment prefix to sign a folder
    // as — an upload that either fails or goes to the wrong tree, and
    // reporting it as configured sends the search everywhere except the
    // variable that is actually missing.
    expect(
      configStatusFrom({
        CLOUDINARY_CLOUD_NAME: "cloud",
        CLOUDINARY_API_KEY: "key",
        CLOUDINARY_API_SECRET: "secret",
      }).cloudinary,
    ).toBe(false);
    expect(
      configStatusFrom({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub" }).webPush,
    ).toBe(false);
    // A key pair with no subject is a 400 at send time, not a partial win.
    expect(
      configStatusFrom({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
      }).webPush,
    ).toBe(false);
    expect(
      configStatusFrom({
        CLOUDINARY_CLOUD_NAME: "cloud",
        CLOUDINARY_API_KEY: "key",
      }).cloudinary,
    ).toBe(false);
  });

  it("treats an empty or whitespace value as unset", () => {
    // A `.env` line left as `GOOGLE_CLIENT_ID=` is not a configuration.
    expect(
      configStatusFrom({ ...full, GOOGLE_CLIENT_ID: "" }).googleOAuth,
    ).toBe(false);
    expect(configStatusFrom({ ...full, SLACK_WEBHOOK_URL: "   " }).slack).toBe(
      false,
    );
  });

  it("returns only booleans, never anything derived from a value", () => {
    // The assertion behind the whole module: no value, no prefix, no length
    // can be read back out of what this returns.
    const status = configStatusFrom(full);
    for (const value of Object.values(status)) {
      expect(typeof value).toBe("boolean");
    }
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("lists a provider as available only when its credentials are complete", () => {
    expect(configuredOAuthProviders(full)).toEqual(["google"]);
    expect(configuredOAuthProviders({ GOOGLE_CLIENT_ID: "id" })).toEqual([]);
    expect(configuredOAuthProviders({})).toEqual([]);
  });
});
