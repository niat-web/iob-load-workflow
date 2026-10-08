import type { PoolProduct, Tone } from "../types/api";

const PRODUCT_TONES: Record<PoolProduct, Tone> = {
  NIAT: "purple",
  Academy: "blue",
  Intensive: "green",
  External: "orange",
  Other: "gray",
  Unknown: "gray",
};

export function productTone(product: string): Tone {
  return PRODUCT_TONES[product as PoolProduct] ?? "gray";
}

export function statusTone(status: string): Tone {
  const value = status.toLowerCase();
  if (value === "eligible") return "green";
  if (value === "placed") return "blue";
  if (value === "mint") return "yellow";
  if (value.includes("not") || value.includes("cheat")) return "red";
  return "gray";
}
