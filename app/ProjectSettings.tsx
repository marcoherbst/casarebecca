"use client";

import { Save, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

export type ProjectSetting = {
  defaultName: string;
  id: string;
  name: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

type ProjectSettingsProps = {
  getAuthToken: () => Promise<string | null>;
  onSaved: (project: ProjectSetting) => void;
  project: ProjectSetting;
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

export default function ProjectSettings({
  getAuthToken,
  onSaved,
  project,
}: ProjectSettingsProps) {
  const [name, setName] = useState(project.name);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const trimmedName = name.trim();
  const hasChanges = trimmedName && trimmedName !== project.name;

  const saveProjectName = async () => {
    if (!hasChanges) return;

    setIsSaving(true);
    setStatus(null);

    try {
      const data = await authedFetch<{ project: ProjectSetting }>(
        getAuthToken,
        `/api/projects/${encodeURIComponent(project.id)}`,
        {
          body: JSON.stringify({ name: trimmedName }),
          method: "PATCH",
        },
      );
      onSaved(data.project);
      setStatus("Project name saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="project-settings-panel" aria-label="Project settings">
      <header>
        <div>
          <span>Project settings</span>
          <h2>{project.name}</h2>
        </div>
        <SlidersHorizontal className="icon" aria-hidden="true" />
      </header>

      <div className="project-name-form">
        <label className="project-name-field">
          <span>Project name</span>
          <input
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>

        <button
          disabled={isSaving || !hasChanges}
          onClick={() => void saveProjectName()}
          type="button"
        >
          <Save className="icon" aria-hidden="true" />
          Save
        </button>
      </div>

      {status ? <p className="admin-status">{status}</p> : null}
    </section>
  );
}
