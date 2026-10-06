import { useId, useState, type FormEvent } from "react";
import * as z from "zod/mini";
import { Button } from "./ui/Button";
import { fieldClass } from "./ui/styles";

const emailSchema = z.email();

interface DevLoginFormProps {
  onSubmit: (email: string) => void;
  pending: boolean;
}

export function DevLoginForm({ onSubmit, pending }: DevLoginFormProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    onSubmit(parsed.data);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-2">
      <label htmlFor={id} className="block text-xs font-bold tracking-wider text-muted uppercase">
        Development login
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          autoComplete="email"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={fieldClass}
        />
        <Button type="submit" variant="secondary" loading={pending}>
          Sign in
        </Button>
      </div>
      {error && (
        <p id={errorId} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
