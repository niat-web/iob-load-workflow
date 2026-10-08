import { CircleCheck, Link2, TriangleAlert, Unlink, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { errorMessage } from "../../api/client";
import { googleConnectUrl, useDisconnectGoogle, useGoogleConnection } from "../../api/interviews";
import type { GoogleConnectionStatus } from "../../types/api";
import { cn } from "../../utils/cn";
import { formatDateTime } from "../../utils/format";
import { ConfirmDialog } from "../ConfirmDialog";
import { useToast } from "../toast-context";
import { Button, buttonClass } from "../ui/Button";
import { cardClass } from "../ui/styles";

const FAILED = "Google sign-in failed. Try again.";

const RESULT_MESSAGES: Record<string, string> = {
  denied: "Google sign-in was cancelled. Click Connect Google to try again.",
  state: "The Google sign-in took too long. Click Connect Google again.",
  scopes: "Allow both Google Calendar and Google Meet access when Google asks, then try again.",
  norefresh: "Google did not give lasting access. Click Connect Google again.",
  setup: "Google sign-in is not set up yet: add GOOGLE_CLIENT_SECRET to apps/api/.env and restart the API.",
  failed: FAILED,
};

function resultMessage(result: string, status: GoogleConnectionStatus | undefined) {
  if (result === "account") {
    return `Sign in as ${status?.expectedEmail ?? "the interview Google account"} when Google asks which account to use.`;
  }
  return RESULT_MESSAGES[result] ?? FAILED;
}

function useConnectResult(status: GoogleConnectionStatus | undefined, ready: boolean) {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const result = params.get("google");
  useEffect(() => {
    if (!result || !ready) return;
    if (result === "connected") toast.success(`Google connected${status?.email ? `: ${status.email}` : ""}. Meets can be created now.`);
    else toast.error(resultMessage(result, status));
    const next = new URLSearchParams(params);
    next.delete("google");
    setParams(next, { replace: true });
  }, [result, ready, status, params, setParams, toast]);
}

export function GoogleConnectCard({ returnTo }: { returnTo: string }) {
  const connection = useGoogleConnection();
  const disconnect = useDisconnectGoogle();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const status = connection.data;
  useConnectResult(status, !connection.isPending);

  if (!status || status.mode === "delegation") return null;

  const connectLink = (label: string) => (
    <a href={googleConnectUrl(returnTo)} className={buttonClass("primary", "md")}>
      <Link2 className="size-4" aria-hidden />
      {label}
    </a>
  );
  const account = status.expectedEmail ?? "the interview Google account";
  const revoked = status.status === "REVOKED";

  return (
    <section aria-label="Google Meet account" className={cn(cardClass, "flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4")}>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          status.connected ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
        )}
      >
        {status.connected ? <CircleCheck className="size-[18px]" aria-hidden /> : <Video className="size-[18px]" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        {status.connected ? (
          <>
            <p className="text-sm font-bold text-ink">Google Meet connected: {status.email}</p>
            <p className="text-xs text-muted">
              Meets, invites and recordings use this account
              {status.connectedBy ? ` · connected by ${status.connectedBy}` : ""}
              {status.connectedAt ? ` on ${formatDateTime(status.connectedAt)}` : ""}.
              {status.mode === "mock" ? " Test mode: Meets are simulated." : ""}
            </p>
          </>
        ) : (
          <>
            <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
              {revoked && <TriangleAlert className="size-4 text-amber-600" aria-hidden />}
              {revoked ? `Google access for ${status.email} was removed or has expired` : "Connect Google to create Meets"}
            </p>
            <p className="text-xs text-muted">
              {status.configured
                ? `Sign in as ${account} and click Allow. Meets, invites and recordings then use that account.`
                : (status.problem ?? "Add GOOGLE_CLIENT_SECRET to apps/api/.env and restart the API.")}
              {status.mode === "mock" ? " Test mode: Meets are simulated until you connect." : ""}
            </p>
          </>
        )}
      </div>
      {status.connected ? (
        <Button variant="secondary" onClick={() => setConfirming(true)} icon={<Unlink className="size-4" aria-hidden />}>
          Disconnect
        </Button>
      ) : (
        status.configured && connectLink(revoked ? "Reconnect Google" : "Connect Google")
      )}

      <ConfirmDialog
        open={confirming}
        title="Disconnect Google?"
        message="Nobody can create Meets until a Google account is connected again. Meets already created keep working."
        confirmLabel="Disconnect"
        confirmVariant="danger"
        pending={disconnect.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSuccess: () => toast.success("Google disconnected"),
            onError: (err) => toast.error(errorMessage(err, "Google could not be disconnected.")),
            onSettled: () => setConfirming(false),
          })
        }
      />
    </section>
  );
}
