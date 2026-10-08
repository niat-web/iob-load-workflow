import { useEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        ux_mode?: "popup" | "redirect";
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        context?: "signin" | "signup" | "use";
      }) => void;
      renderButton: (
        parent: HTMLElement,
        options: {
          type?: "standard" | "icon";
          theme?: "outline" | "filled_blue" | "filled_black";
          size?: "large" | "medium" | "small";
          text?: "signin_with" | "signup_with" | "continue_with" | "signin";
          shape?: "rectangular" | "pill" | "circle" | "square";
          logo_alignment?: "left" | "center";
          width?: number;
        },
      ) => void;
      disableAutoSelect: () => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const SCRIPT_URL = "https://accounts.google.com/gsi/client";
let scriptPromise: Promise<GoogleIdentity> | null = null;

function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  scriptPromise ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener(
      "load",
      () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error("Google sign-in did not load"))),
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        scriptPromise = null;
        script.remove();
        reject(new Error("Google sign-in could not be loaded"));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });
  return scriptPromise;
}

interface GoogleSignInButtonProps {
  clientId: string;
  disabled?: boolean;
  onCredential: (credential: string) => void;
}

export function GoogleSignInButton({ clientId, disabled, onCredential }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    let active = true;
    loadGoogleIdentity()
      .then((google) => {
        const container = containerRef.current;
        if (!active || !container) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) callbackRef.current(response.credential);
          },
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          context: "signin",
        });
        container.replaceChildren();
        google.accounts.id.renderButton(container, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: 360,
        });
        setLoadError(null);
      })
      .catch(() => {
        if (active) setLoadError("Google sign-in could not load. Check your connection and refresh the page.");
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={containerRef}
        aria-busy={disabled || undefined}
        className={cn("flex min-h-11 w-full justify-center", disabled && "pointer-events-none opacity-60")}
      />
      {loadError && (
        <p role="alert" className="text-center text-sm text-red-600">
          {loadError}
        </p>
      )}
    </div>
  );
}
