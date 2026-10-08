import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import * as z from "zod/mini";
import { requestEmailCode } from "../api/auth";
import { errorMessage } from "../api/client";
import { Button } from "./ui/Button";
import { fieldClass } from "./ui/styles";

const emailSchema = z.email();

interface EmailCodeFormProps {
  pending: boolean;
  onSubmit: (email: string, code: string) => void;
}

function useCountdown(seconds: number) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const timer = window.setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  return { left, start: () => setLeft(seconds) };
}

export function EmailCodeForm({ pending, onSubmit }: EmailCodeFormProps) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(10);
  const countdown = useCountdown(60);

  const send = useMutation({
    mutationFn: requestEmailCode,
    onSuccess: (result, address) => {
      setSentTo(address);
      setMinutes(result.expiresInMinutes);
      setCode("");
      setError(null);
      countdown.start();
    },
    onError: (err) => setError(errorMessage(err, "The code could not be sent. Try again.")),
  });

  const sendCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email.trim().toLowerCase());
    if (!parsed.success) {
      setError("Enter a valid email address.");
      return;
    }
    send.mutate(parsed.data);
  };

  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sentTo) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setError(null);
    onSubmit(sentTo, code);
  };

  if (!sentTo) {
    return (
      <form onSubmit={sendCode} noValidate className="space-y-3">
        <label htmlFor={`${id}-email`} className="block text-sm font-semibold text-ink">
          Work email
        </label>
        <input
          id={`${id}-email`}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          aria-invalid={error ? true : undefined}
          className={fieldClass}
        />
        <Button type="submit" className="h-11 w-full" loading={send.isPending}>
          Send sign-in code
        </Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={signIn} noValidate className="space-y-3">
      <p className="text-sm text-muted">
        If <span className="font-semibold text-ink">{sentTo}</span> has access, a 6-digit code is on its way. It expires
        in {minutes} minutes.
      </p>
      <label htmlFor={`${id}-code`} className="block text-sm font-semibold text-ink">
        Sign-in code
      </label>
      <input
        id={`${id}-code`}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        aria-invalid={error ? true : undefined}
        className={`${fieldClass} text-center text-lg tracking-[0.4em] tabular-nums`}
      />
      <Button type="submit" className="h-11 w-full" loading={pending} disabled={code.length !== 6}>
        Sign in
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          className="focus-ring rounded font-semibold text-muted hover:text-ink"
          onClick={() => {
            setSentTo(null);
            setError(null);
          }}
        >
          Use a different email
        </button>
        <button
          type="button"
          className="focus-ring rounded font-semibold text-primary disabled:text-muted"
          disabled={countdown.left > 0 || send.isPending}
          onClick={() => send.mutate(sentTo)}
        >
          {countdown.left > 0 ? `Send a new code in ${countdown.left}s` : "Send a new code"}
        </button>
      </div>
    </form>
  );
}
