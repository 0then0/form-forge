"use client";

import { Button } from "@form-forge/ui";
import { signIn } from "next-auth/react";
import { useState } from "react";
import {
  ProviderIcon,
  providerLabels,
  type SignInProvider,
} from "./provider-icon";

export const SignInButton = ({
  enabledProviders,
  linkedProviders = [],
  linking = false,
}: {
  enabledProviders: string[];
  linkedProviders?: string[];
  linking?: boolean;
}) => {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const start = async (provider: SignInProvider) => {
    if (
      linking &&
      !window.confirm(
        `Link ${providerLabels[provider]} to your current Form Forge account? Only continue with an account you own.`,
      )
    )
      return;
    setPending(provider);
    setError(undefined);
    try {
      await signIn(provider, {
        callbackUrl: linking ? `/account?linked=${provider}` : "/app",
      });
    } catch {
      setError("Sign-in could not be started. Please try again.");
    } finally {
      setPending(undefined);
    }
  };
  return (
    <div className="space-y-3">
      {(Object.keys(providerLabels) as SignInProvider[]).map((provider) => {
        const linked = linkedProviders.includes(provider);
        const enabled = enabledProviders.includes(provider);
        return (
          <Button
            key={provider}
            variant="secondary"
            className="h-12 w-full justify-start gap-3 rounded-xl px-5"
            disabled={!enabled || linked || !!pending}
            onClick={() => void start(provider)}
          >
            <ProviderIcon provider={provider} />
            <span className="flex-1 text-left">
              {linking
                ? `Link ${providerLabels[provider]}`
                : `Continue with ${providerLabels[provider]}`}
            </span>
            <span className="text-xs font-normal text-slate-500">
              {pending === provider
                ? "Connecting…"
                : linked
                  ? "Linked"
                  : !enabled
                    ? "Unavailable"
                    : ""}
            </span>
          </Button>
        );
      })}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
};
