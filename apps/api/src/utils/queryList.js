import { z } from "zod";

export const listOf = (item) =>
  z
    .string()
    .max(4000)
    .optional()
    .transform((value) => [...new Set((value ?? "").split("|").map((part) => part.trim()).filter(Boolean))])
    .pipe(z.array(item).max(200));
