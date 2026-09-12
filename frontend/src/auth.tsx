import { Auth0Provider, useAuth0, type AppState } from "@auth0/auth0-react";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { User } from "@auth0/auth0-react";
import { AUTH0_CLIENT_ID, AUTH0_DOMAIN, isAuth0Configured } from "./authConfig";
import { savePendingRole, type Role } from "./session";

export interface CrewAuth {
  configured: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  user: User | undefined;
  error: Error | undefined;
  login: (role: Role, mode?: "login" | "signup") => Promise<void>;
  logout: () => void;
  getIdToken: () => Promise<string | undefined>;
}

const CrewAuthContext = createContext<CrewAuth | null>(null);

const unconfigured: CrewAuth = {
  configured: false,
  isLoading: false,
  isAuthenticated: false,
  user: undefined,
  error: undefined,
  login: async () => {
    throw new Error("Auth0 is not configured.");
  },
  logout: () => undefined,
  getIdToken: async () => undefined,
};

function clearCallbackParams() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("code") && !url.searchParams.has("state") && !url.searchParams.has("error")) {
    return;
  }
  url.search = "";
  window.history.replaceState({}, document.title, `${url.pathname}${url.hash}`);
}

function Auth0Bridge({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user, error, loginWithRedirect, logout, getIdTokenClaims } = useAuth0();

  useEffect(() => {
    if (error) clearCallbackParams();
  }, [error]);

  const value = useMemo<CrewAuth>(
    () => ({
      configured: true,
      isLoading,
      isAuthenticated,
      user,
      error,
      login: async (role, mode = "login") => {
        savePendingRole(role);
        await loginWithRedirect({
          appState: { role },
          authorizationParams: mode === "signup" ? { screen_hint: "signup" } : undefined,
        });
      },
      logout: () => {
        logout({ logoutParams: { returnTo: window.location.origin } });
      },
      getIdToken: async () => {
        for (let i = 0; i < 6; i += 1) {
          const claims = await getIdTokenClaims();
          if (claims?.__raw) return claims.__raw;
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
        return undefined;
      },
    }),
    [error, getIdTokenClaims, isAuthenticated, isLoading, loginWithRedirect, logout, user],
  );

  return <CrewAuthContext.Provider value={value}>{children}</CrewAuthContext.Provider>;
}

function onRedirectCallback(appState?: AppState) {
  const role = appState?.role;
  if (role === "student" || role === "teacher") {
    savePendingRole(role);
  }
  window.history.replaceState({}, document.title, appState?.returnTo ?? window.location.pathname);
}

export function CrewAuthProvider({ children }: { children: ReactNode }) {
  if (!isAuth0Configured()) {
    return <CrewAuthContext.Provider value={unconfigured}>{children}</CrewAuthContext.Provider>;
  }

  return (
    <Auth0Provider
      domain={AUTH0_DOMAIN}
      clientId={AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        scope: "openid profile email",
      }}
      cacheLocation="localstorage"
      onRedirectCallback={onRedirectCallback}
    >
      <Auth0Bridge>{children}</Auth0Bridge>
    </Auth0Provider>
  );
}

export function useCrewAuth(): CrewAuth {
  const ctx = useContext(CrewAuthContext);
  if (!ctx) {
    throw new Error("useCrewAuth must be used within CrewAuthProvider");
  }
  return ctx;
}
