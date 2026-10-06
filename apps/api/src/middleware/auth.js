import { config } from "../config/env.js";
import { User } from "../models/index.js";
import { clearSession, readSession } from "../services/authService.js";
import { AppError, forbidden, unauthenticated } from "../utils/errors.js";

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[config.auth.cookieName];
    const session = token ? readSession(token) : null;
    if (!session?.sub) {
      if (token) clearSession(res);
      throw unauthenticated();
    }
    const user = await User.findOne({ email: session.sub }).lean();
    if (!user || !user.isActive) {
      clearSession(res);
      throw new AppError(403, "ACCESS_DENIED", "Your access has been removed");
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (req.user?.role === "ADMIN" || roles.includes(req.user?.role)) return next();
    next(forbidden(`This area is only available to ${roles.join(" / ")} users`));
  };
}
