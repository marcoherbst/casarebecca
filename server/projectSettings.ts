import type { SupabaseClient } from "@supabase/supabase-js";
import { PROTECTED_MODEL_CATALOG } from "../modelCatalog.js";
import { ApiError } from "./supabaseAuth.js";

const PROJECT_SETTINGS_TABLE = "project_settings";

export type ProjectSetting = {
  defaultName: string;
  id: string;
  name: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

type ProjectSettingsRow = {
  name: string;
  project_id: string;
  updated_at: string | null;
  updated_by: string | null;
};

const DEFAULT_PROJECTS = [
  ...PROTECTED_MODEL_CATALOG.map((project) => ({
    id: project.id,
    name: project.projectName,
  })),
  {
    id: "demo",
    name: "Demo",
  },
];

export function isKnownProjectId(projectId: string) {
  return DEFAULT_PROJECTS.some((project) => project.id === projectId);
}

export function cleanProjectName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";

  if (!name) {
    throw new ApiError(400, "Project name is required.");
  }

  if (name.length > 80) {
    throw new ApiError(400, "Project name must be 80 characters or fewer.");
  }

  return name;
}

export async function listProjectSettings(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from(PROJECT_SETTINGS_TABLE)
    .select("project_id,name,updated_at,updated_by")
    .in(
      "project_id",
      DEFAULT_PROJECTS.map((project) => project.id),
    );

  if (error) {
    if (isMissingProjectSettingsTable(error)) {
      return DEFAULT_PROJECTS.map((project) => ({
        defaultName: project.name,
        id: project.id,
        name: project.name,
        updatedAt: null,
        updatedBy: null,
      }));
    }

    throw new ApiError(500, error.message);
  }

  const savedRows = new Map(
    (data as ProjectSettingsRow[] | null | undefined)?.map((row) => [
      row.project_id,
      row,
    ]) ?? [],
  );

  return DEFAULT_PROJECTS.map((project) => {
    const saved = savedRows.get(project.id);

    return {
      defaultName: project.name,
      id: project.id,
      name: saved?.name || project.name,
      updatedAt: saved?.updated_at ?? null,
      updatedBy: saved?.updated_by ?? null,
    };
  });
}

export async function updateProjectName(
  supabase: SupabaseClient,
  projectId: string,
  name: string,
  updatedBy: string,
) {
  if (!isKnownProjectId(projectId)) {
    throw new ApiError(404, "Project not found.");
  }

  const { data, error } = await supabase
    .from(PROJECT_SETTINGS_TABLE)
    .upsert(
      {
        name,
        project_id: projectId,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      },
      {
        onConflict: "project_id",
      },
    )
    .select("project_id,name,updated_at,updated_by")
    .single();

  if (error) {
    if (isMissingProjectSettingsTable(error)) {
      throw new ApiError(
        500,
        "Project settings database table is not configured.",
      );
    }

    throw new ApiError(500, error.message);
  }

  const defaults = DEFAULT_PROJECTS.find((project) => project.id === projectId);
  const row = data as ProjectSettingsRow;

  return {
    defaultName: defaults?.name ?? name,
    id: row.project_id,
    name: row.name,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  } satisfies ProjectSetting;
}

function isMissingProjectSettingsTable(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    Boolean(error.message?.includes(PROJECT_SETTINGS_TABLE))
  );
}
