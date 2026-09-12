import type { User } from "@auth0/auth0-react";

export const AUTH0_DOMAIN = (import.meta.env.VITE_AUTH0_DOMAIN ?? "").trim();
export const AUTH0_CLIENT_ID = (import.meta.env.VITE_AUTH0_CLIENT_ID ?? "").trim();

export function isAuth0Configured() {
  return Boolean(AUTH0_DOMAIN && AUTH0_CLIENT_ID);
}

export function displayNameFromUser(user: User): string {
  const email = user.email?.trim();
  const name = user.name?.trim();
  if (name && name !== email) return name;
  const full = [user.given_name, user.family_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  const nick = user.nickname?.trim();
  if (nick && !nick.includes("@")) return nick;
  const fromEmail = email?.split("@")[0]?.trim();
  if (fromEmail) return fromEmail;
  return "You";
}
