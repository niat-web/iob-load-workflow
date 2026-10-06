import type { IPublicClientApplication } from "@azure/msal-browser";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

interface MicrosoftSignInButtonProps {
  clientId: string;
  tenantId: string;
  disabled?: boolean;
  onIdToken: (idToken: string) => void;
}

const SCOPES = ["openid", "profile", "email"];

let cached: { key: string; app: Promise<IPublicClientApplication> } | null = null;

function microsoftClient(clientId: string, tenantId: string) {
  const key = `${clientId}:${tenantId}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      app: import("@azure/msal-browser").then(async ({ PublicClientApplication }) => {
        const app = new PublicClientApplication({
          auth: {
            clientId,
            authority: `https://login.microsoftonline.com/${tenantId}`,
            redirectUri: `${window.location.origin}/redirect.html`,
          },
          cache: { cacheLocation: "sessionStorage" },
        });
        await app.initialize();
        return app;
      }),
    };
  }
  return cached.app;
}

function errorText(error: unknown): string | null {
  const code = (error as { errorCode?: string } | null)?.errorCode;
  if (code === "user_cancelled") return null;
  if (code === "popup_window_error" || code === "empty_window_error") return "Allow pop-ups for this site, then try again.";
  if (code === "interaction_in_progress") return "A Microsoft sign-in window is already open.";
  if (code === "no_network_connectivity") return "Check your internet connection, then try again.";
  return "Microsoft sign-in did not finish. Try again.";
}

function MicrosoftLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function MicrosoftSignInButton({ clientId, tenantId, disabled, onIdToken }: MicrosoftSignInButtonProps) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void microsoftClient(clientId, tenantId).catch(() => {});
  }, [clientId, tenantId]);

  const signIn = async () => {
    setOpening(true);
    setError(null);
    try {
      const app = await microsoftClient(clientId, tenantId);
      const result = await app.loginPopup({ scopes: SCOPES, prompt: "select_account" });
      onIdToken(result.idToken);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => void signIn()}
        disabled={disabled || opening}
        className="focus-ring inline-flex h-11 w-full max-w-[300px] items-center justify-center gap-3 rounded-md border border-slate-400 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {opening ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <MicrosoftLogo />}
        Sign in with Microsoft
      </button>
      {error && (
        <p role="alert" className="text-center text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
