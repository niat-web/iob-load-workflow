import * as z from "zod/mini";

const RAW_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export const API_BASE = `${RAW_BASE.trim().replace(/\/+$/, "")}/api`;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function hasStatus(error: unknown, ...statuses: number[]): error is ApiError {
  return isApiError(error) && statuses.includes(error.status);
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (isApiError(error) && error.message) return error.message;
  return fallback;
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.optional(z.unknown()),
  }),
});

type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
}

export function apiUrl(path: string, query?: QueryParams): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export function seg(value: string): string {
  return encodeURIComponent(value);
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const DEFAULT_MESSAGES: Record<number, string> = {
  400: "The request was not valid.",
  401: "Your session has expired. Please sign in again.",
  403: "You do not have access to this resource.",
  404: "Not found.",
  409: "This action conflicts with the current state.",
  410: "This link has expired.",
  429: "Too many requests. Please wait a moment and try again.",
};

async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    headers["X-Requested-With"] = "XMLHttpRequest";
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path, options.query), {
      method,
      headers,
      credentials: "include",
      body: method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, "NETWORK_ERROR", "Unable to reach the server. Check your connection and try again.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    if (response.status === 401) {
      for (const listener of unauthorizedListeners) listener();
    }
    const parsed = errorBodySchema.safeParse(payload);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(response.status, code, message, details ?? null);
    }
    throw new ApiError(
      response.status,
      response.status >= 500 ? "INTERNAL_ERROR" : "HTTP_ERROR",
      DEFAULT_MESSAGES[response.status] ?? "Something went wrong. Please try again.",
    );
  }

  if (payload === undefined) {
    throw new ApiError(response.status, "INVALID_RESPONSE", "The server returned an unexpected response.");
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) =>
    request<T>("GET", path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, { body }),
};
