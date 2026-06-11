import { createClient, type User } from "@supabase/supabase-js";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "node:http";

export type Role = "admin" | "user";

export type ApiRequest = IncomingMessage & {
  body?: unknown;
  headers: IncomingHttpHeaders;
};

export type UserSummary = {
  createdAt: number;
  email: string;
  id: string;
  lastSignInAt: number | null;
  name: string;
  role: Role;
};

export type InvitationSummary = {
  createdAt: number;
  email: string;
  id: string;
  role: Role;
  status: string;
};

const validRoles = new Set<Role>(["admin", "user"]);

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function sendError(res: ServerResponse, error: unknown) {
  if (error instanceof ApiError) {
    sendJson(res, error.statusCode, { error: error.message });
    return;
  }

  const message =
    error instanceof Error ? error.message : "Unexpected server error.";
  sendJson(res, 500, { error: message });
}

export function requireMethod(
  req: ApiRequest,
  res: ServerResponse,
  methods: string[],
) {
  if (req.method && methods.includes(req.method)) return;
  res.setHeader("Allow", methods.join(", "));
  throw new ApiError(405, "Method not allowed.");
}

export function parseRole(value: unknown): Role {
  if (typeof value === "string" && validRoles.has(value as Role)) {
    return value as Role;
  }

  throw new ApiError(400, "Role must be admin or user.");
}

export async function readJsonBody<T extends Record<string, unknown>>(
  req: ApiRequest,
): Promise<T> {
  if (req.body && typeof req.body === "object") {
    return req.body as T;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {} as T;

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
}

export function getRequestOrigin(req: ApiRequest) {
  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto || "https";
  const host = firstHeaderValue(req.headers.host) || "localhost:3000";
  return `${protocol}://${host}`;
}

export function getUserIdFromPath(req: ApiRequest, segment: string) {
  const origin = getRequestOrigin(req);
  const pathname = new URL(req.url ?? "", origin).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const index = parts.indexOf(segment);
  const value = index >= 0 ? parts[index + 1] : "";

  if (!value) {
    throw new ApiError(400, "User id is required.");
  }

  return decodeURIComponent(value);
}

export function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new ApiError(
      500,
      "Supabase server environment variables are not configured.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function requireUser(req: ApiRequest) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    throw new ApiError(401, "Sign in is required.");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new ApiError(401, "Session could not be verified.");
  }

  if (!isAppUser(data.user)) {
    throw new ApiError(403, "This account has not been added to the app.");
  }

  return { supabase, user: data.user, userId: data.user.id };
}

export async function requireAdmin(req: ApiRequest) {
  const auth = await requireUser(req);
  if (!isAdmin(auth.user)) {
    throw new ApiError(403, "Admin access is required.");
  }

  return auth;
}

export function isAdmin(user: User) {
  const role = metadataRole(user.app_metadata);
  return role === "admin" || isBootstrapAdmin(primaryEmail(user));
}

export function isAppUser(user: User) {
  return isAdmin(user) || metadataRole(user.app_metadata) === "user";
}

export function userSummary(user: User): UserSummary {
  return {
    createdAt: dateToMs(user.created_at) ?? 0,
    email: primaryEmail(user),
    id: user.id,
    lastSignInAt: dateToMs(user.last_sign_in_at),
    name: userName(user),
    role: isAdmin(user) ? "admin" : (metadataRole(user.app_metadata) ?? "user"),
  };
}

export function invitationSummary(user: User): InvitationSummary {
  return {
    createdAt: dateToMs(user.invited_at ?? user.created_at) ?? 0,
    email: primaryEmail(user),
    id: user.id,
    role: metadataRole(user.app_metadata) ?? "user",
    status: user.confirmed_at ? "accepted" : "pending",
  };
}

export function mergeRoleMetadata(
  metadata: Record<string, unknown>,
  role: Role,
) {
  return {
    ...metadata,
    role,
  };
}

export function isPendingInvitation(user: User) {
  return Boolean(user.invited_at && !user.confirmed_at);
}

function metadataRole(metadata: Record<string, unknown> | null): Role | null {
  if (metadata?.role === "admin") return "admin";
  if (metadata?.role === "user") return "user";
  return null;
}

function primaryEmail(user: User) {
  return user.email ?? "";
}

function userName(user: User) {
  const metadata = user.user_metadata ?? {};
  if (typeof metadata.full_name === "string") return metadata.full_name;
  if (typeof metadata.name === "string") return metadata.name;
  return "";
}

function isBootstrapAdmin(email: string) {
  if (!email) return false;

  const admins = (process.env.SUPABASE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return admins.includes(email.toLowerCase());
}

function dateToMs(value?: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function extractBearerToken(header: string | string[] | undefined) {
  const value = firstHeaderValue(header);
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length).trim();
}

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}
