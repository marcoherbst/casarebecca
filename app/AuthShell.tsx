"use client";

import { LogIn, LogOut } from "lucide-react";
import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import AdminUsers from "./AdminUsers";
import BimStreamer from "./BimStreamer";
import type { ProjectSetting } from "./ProjectSettings";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const APP_NAME = "Evercam Open";

type Role = "admin" | "user";

type CurrentUser = {
  email: string;
  id: string;
  name: string;
  role: Role;
};

async function fetchJson<T>(
  url: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

function GoogleSignInButton() {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startGoogleSignIn = async () => {
    if (!supabase) return;

    setIsStarting(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithOAuth({
      options: {
        redirectTo: window.location.origin,
      },
      provider: "google",
    });

    if (signInError) {
      setError(signInError.message);
      setIsStarting(false);
    }
  };

  return (
    <>
      <button
        className="google-sign-in"
        disabled={!supabase || isStarting}
        onClick={() => void startGoogleSignIn()}
        type="button"
      >
        <LogIn className="icon" aria-hidden="true" />
        {isStarting ? "Opening Google..." : "Continue with Google"}
      </button>
      {error ? <p className="error-text auth-error">{error}</p> : null}
    </>
  );
}

function SignInScreen() {
  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-label="Sign in">
        <span>{APP_NAME}</span>
        <h1>BIM file streamer</h1>
        <p>Google SSO is required for access.</p>
        <GoogleSignInButton />
      </section>
    </main>
  );
}

function AccountErrorScreen({
  message,
  onSignOut,
}: {
  message: string;
  onSignOut: () => void;
}) {
  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-label="Account access">
        <span>Access pending</span>
        <h1>Account not enabled</h1>
        <p>{message}</p>
        <button className="google-sign-in" onClick={onSignOut} type="button">
          <LogOut className="icon" aria-hidden="true" />
          Sign out
        </button>
      </section>
    </main>
  );
}

export function MissingSupabaseConfig() {
  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-label="Authentication setup">
        <span>Setup needed</span>
        <h1>Supabase is not configured</h1>
        <p>
          Add Supabase environment variables on Vercel to enable Google SSO and
          user management.
        </p>
      </section>
    </main>
  );
}

function fallbackUser(user: User): CurrentUser {
  const metadata = user.user_metadata ?? {};
  const name =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : "Account";

  return {
    email: user.email ?? "",
    id: user.id,
    name,
    role: "user",
  };
}

export function AuthControls({
  currentUser,
  onSignOut,
}: {
  currentUser: CurrentUser | null;
  onSignOut: () => void;
}) {
  return (
    <div className="auth-controls">
      <div className="signed-in-user">
        <span>{currentUser?.role ?? "signed in"}</span>
        <strong>{currentUser?.name || currentUser?.email || "Account"}</strong>
      </div>

      <div className="auth-actions">
        <button className="sign-out-button" onClick={onSignOut} type="button">
          <LogOut className="icon" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function AuthShell() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [currentUserError, setCurrentUserError] = useState<string | null>(null);
  const [isProjectSettingsOpen, setIsProjectSettingsOpen] = useState(false);
  const [isLoaded, setIsLoaded] = useState(!isSupabaseConfigured);
  const [projectSettings, setProjectSettings] = useState<
    Record<string, ProjectSetting>
  >({});
  const [session, setSession] = useState<Session | null>(null);

  const getAuthToken = useCallback(
    () => Promise.resolve(session?.access_token ?? null),
    [session?.access_token],
  );

  useEffect(() => {
    if (!supabase) return;

    const client = supabase;
    let cancelled = false;

    const loadSession = async () => {
      const { data } = await client.auth.getSession();
      if (!cancelled) {
        setSession(data.session);
        setIsLoaded(true);
      }
    };

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoaded(true);
      if (!nextSession) {
        setCurrentUser(null);
        setIsProjectSettingsOpen(false);
        setProjectSettings({});
      }
    });

    void loadSession();

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.access_token) return;

    let cancelled = false;

    const loadCurrentUser = async () => {
      try {
        const data = await fetchJson<{ user: CurrentUser }>(
          "/api/me",
          session.access_token,
        );
        if (!cancelled) {
          setCurrentUser(data.user);
          setCurrentUserError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setCurrentUserError(
            error instanceof Error
              ? error.message
              : "Could not load account details.",
          );
        }
      }
    };

    void loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token || currentUser?.id !== session.user.id) return;

    let cancelled = false;

    const loadProjectSettings = async () => {
      try {
        const data = await fetchJson<{ projects: ProjectSetting[] }>(
          "/api/projects",
          session.access_token,
        );
        if (!cancelled) {
          setProjectSettings(
            Object.fromEntries(
              data.projects.map((project) => [project.id, project]),
            ),
          );
        }
      } catch {
        if (!cancelled) {
          setProjectSettings({});
        }
      }
    };

    void loadProjectSettings();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, session?.access_token, session?.user.id]);

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  if (!isSupabaseConfigured) {
    return <MissingSupabaseConfig />;
  }

  if (!isLoaded) {
    return (
      <main className="auth-screen">
        <section className="auth-panel" aria-label="Loading authentication">
          <span>{APP_NAME}</span>
          <h1>Checking session</h1>
        </section>
      </main>
    );
  }

  if (!session) {
    return <SignInScreen />;
  }

  const verifiedCurrentUser =
    currentUser && currentUser.id === session.user.id ? currentUser : null;
  const canManageUsers = verifiedCurrentUser?.role === "admin";

  if (currentUserError) {
    return (
      <AccountErrorScreen
        message={currentUserError}
        onSignOut={() => void signOut()}
      />
    );
  }

  if (!verifiedCurrentUser) {
    return (
      <main className="auth-screen">
        <section className="auth-panel" aria-label="Loading account">
          <span>{APP_NAME}</span>
          <h1>Checking access</h1>
        </section>
      </main>
    );
  }

  return (
    <BimStreamer
      controlSlot={
        <>
          <AuthControls
            currentUser={verifiedCurrentUser ?? fallbackUser(session.user)}
            onSignOut={() => void signOut()}
          />
          {currentUserError ? (
            <p className="error-text auth-error">{currentUserError}</p>
          ) : null}
        </>
      }
      applicationSettingsSlot={
        canManageUsers ? <AdminUsers getAuthToken={getAuthToken} /> : null
      }
      canManageProjectSettings={canManageUsers}
      getAuthToken={getAuthToken}
      isProjectSettingsOpen={isProjectSettingsOpen}
      onProjectNameSaved={(project) =>
        setProjectSettings((current) => ({
          ...current,
          [project.id]: project,
        }))
      }
      onProjectSettingsToggle={() =>
        setIsProjectSettingsOpen((open) => !open)
      }
      projectSettings={projectSettings}
    />
  );
}
