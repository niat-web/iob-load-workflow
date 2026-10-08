import type { Role } from "../types/api";

export const CRM_ROLES: readonly Role[] = ["CRM", "ADMIN"];
export const PSM_ROLES: readonly Role[] = ["PSM", "ADMIN"];
export const ALL_ROLES: readonly Role[] = ["CRM", "PSM", "ADMIN"];
export const ADMIN_ROLES: readonly Role[] = ["ADMIN"];

export function homePathFor(role: Role): string {
  return role === "PSM" ? "/psm" : "/crm";
}

export function canAccessPath(role: Role, path: string): boolean {
  const pathname = path.split(/[?#]/)[0] ?? "";
  if (pathname === "/crm" || pathname.startsWith("/crm/")) return CRM_ROLES.includes(role);
  if (pathname === "/psm" || pathname.startsWith("/psm/")) return PSM_ROLES.includes(role);
  if (pathname === "/settings") return ALL_ROLES.includes(role);
  if (["/settings/users", "/settings/bigquery", "/settings/config"].includes(pathname)) return role === "ADMIN";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return ADMIN_ROLES.includes(role);
  return false;
}

export function isSafeInternalPath(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}
