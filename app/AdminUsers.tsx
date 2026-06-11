"use client";

import { RefreshCw, Trash2, UserPlus, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Role = "admin" | "user";

type UserSummary = {
  createdAt: number;
  email: string;
  id: string;
  lastSignInAt: number | null;
  name: string;
  role: Role;
};

type InvitationSummary = {
  createdAt: number;
  email: string;
  id: string;
  role: Role;
  status: string;
};

type UsersResponse = {
  invitations: InvitationSummary[];
  users: UserSummary[];
};

type AdminUsersProps = {
  getAuthToken: () => Promise<string | null>;
};

const formatDate = (timestamp: number | null) => {
  if (!timestamp) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
};

async function authedFetch<T>(
  getAuthToken: () => Promise<string | null>,
  url: string,
  init?: RequestInit,
) {
  const token = await getAuthToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<T>;
}

export default function AdminUsers({ getAuthToken }: AdminUsersProps) {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const sortedUsers = useMemo(
    () =>
      [...(data?.users ?? [])].sort((a, b) =>
        a.email.localeCompare(b.email),
      ),
    [data?.users],
  );

  const pendingInvitations = useMemo(
    () =>
      [...(data?.invitations ?? [])].sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [data?.invitations],
  );

  const loadUsers = async () => {
    const users = await authedFetch<UsersResponse>(getAuthToken, "/api/users");
    setData(users);
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const users = await authedFetch<UsersResponse>(
          getAuthToken,
          "/api/users",
        );
        if (!cancelled) setData(users);
      } catch (error) {
        if (!cancelled) {
          setStatus(
            error instanceof Error ? error.message : "Could not load users.",
          );
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [getAuthToken]);

  const addUser = async () => {
    if (!email.trim()) return;

    setIsBusy(true);
    setStatus(null);
    try {
      await authedFetch(getAuthToken, "/api/users", {
        body: JSON.stringify({ email: email.trim(), role }),
        method: "POST",
      });
      setEmail("");
      setRole("user");
      await loadUsers();
      setStatus("User added.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Add failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const updateRole = async (userId: string, nextRole: Role) => {
    setIsBusy(true);
    setStatus(null);
    try {
      await authedFetch(getAuthToken, `/api/users/${userId}`, {
        body: JSON.stringify({ role: nextRole }),
        method: "PATCH",
      });
      await loadUsers();
      setStatus("Role updated.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not update role.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const deleteUser = async (userId: string) => {
    setIsBusy(true);
    setStatus(null);
    try {
      await authedFetch(getAuthToken, `/api/users/${userId}`, {
        method: "DELETE",
      });
      await loadUsers();
      setStatus("User removed.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not remove user.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <section className="admin-panel" aria-label="User management">
      <header>
        <div>
          <span>Settings</span>
          <h2>User management</h2>
        </div>
        <UsersRound className="icon" aria-hidden="true" />
      </header>

      <div className="invite-form">
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
          type="email"
          value={email}
        />
        <select
          aria-label="Role"
          onChange={(event) => setRole(event.target.value as Role)}
          value={role}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <button
          disabled={isBusy || !email.trim()}
          onClick={addUser}
          type="button"
        >
          <UserPlus className="icon" aria-hidden="true" />
          Add
        </button>
      </div>

      {status ? <p className="admin-status">{status}</p> : null}

      <div className="admin-user-list">
        {sortedUsers.map((account) => (
          <article className="admin-user-row" key={account.id}>
            <div>
              <strong>{account.name || account.email}</strong>
              <span>{account.email}</span>
              <small>Last sign-in: {formatDate(account.lastSignInAt)}</small>
            </div>
            <select
              aria-label={`Role for ${account.email}`}
              disabled={isBusy}
              onChange={(event) =>
                void updateRole(account.id, event.target.value as Role)
              }
              value={account.role}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <button
              disabled={isBusy}
              onClick={() => void deleteUser(account.id)}
              type="button"
            >
              {isBusy ? (
                <RefreshCw className="icon spin" aria-hidden="true" />
              ) : (
                <Trash2 className="icon" aria-hidden="true" />
              )}
              Remove
            </button>
          </article>
        ))}
      </div>

      {pendingInvitations.length ? (
        <div className="invitation-list">
          <h3>Pending invitations</h3>
          {pendingInvitations.map((invitation) => (
            <div className="invitation-row" key={invitation.id}>
              <span>{invitation.email}</span>
              <strong>{invitation.role}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
