import type { User } from "@auth0/auth0-react";

export const AUTH0_DOMAIN = (import.meta.env.VITE_AUTH0_DOMAIN ?? "").trim();
export const AUTH0_CLIENT_ID = (import.meta.env.VITE_AUTH0_CLIENT_ID ?? "").trim();

export function isAuth0Configured() {
  return Boolean(AUTH0_DOMAIN && AUTH0_CLIENT_ID);
}

export function displayNameFromUser(user: User): string {
  const given = user.given_name?.trim();
  if (given) return given;
  const nick = user.nickname?.trim();
  if (nick && !nick.includes("@")) return nick;
  const name = user.name?.trim();
  if (name && name !== user.email) {
    const first = name.split(/\s+/)[0];
    if (first) return first;
  }
  const fromEmail = user.email?.split("@")[0]?.trim();
  if (fromEmail) return fromEmail;
  return "You";
}
