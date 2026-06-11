"use client";

import {
  Building2,
  CircleCheck,
  Database,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ModelStatus = "idle" | "streaming" | "loaded" | "error";

type ProjectId = "demo" | "casa";

type DemoModel = {
  description: string;
  disabledReason?: string;
  id: string;
  name: string;
  project: ProjectId;
  sourceFormat: string;
  size: string;
  url?: string;
};

type ModelState = {
  bytesLoaded: number;
  bytesTotal: number;
  error?: string;
  percent: number;
  status: ModelStatus;
};

type Runtime = {
  components: { dispose: () => void };
  fragments: {
    core: {
      disposeModel: (modelId: string) => Promise<void> | void;
      load: (
        buffer: ArrayBuffer,
        options: { modelId: string },
      ) => Promise<unknown>;
      update: (force?: boolean) => void;
    };
    list: Map<string, unknown>;
  };
};

type BimStreamerProps = {
  controlSlot?: ReactNode;
  getAuthToken?: () => Promise<string | null>;
};

const MODELS: DemoModel[] = [
  {
    description: "Architectural shell, rooms, walls, slabs, and openings",
    id: "school_arq",
    name: "School Architecture",
    project: "demo",
    sourceFormat: "Fragments",
    size: "3.4 MB",
    url: "/models/school_arq.frag",
  },
  {
    description: "Structural frame loaded as a separate BIM discipline",
    id: "school_str",
    name: "School Structure",
    project: "demo",
    sourceFormat: "Fragments",
    size: "0.7 MB",
    url: "/models/school_str.frag",
  },
  {
    description: "IFC4 export converted into a streamable ThatOpen Fragment",
    id: "casa_rebecca",
    name: "Casa Rebecca",
    project: "casa",
    sourceFormat: "Fragments",
    size: "12.4 MB",
    url: "/api/models/casa_rebecca",
  },
];

const PROJECTS: Array<{
  description: string;
  id: ProjectId;
  label: string;
}> = [
  {
    description: "IFC4 export converted to Fragments",
    id: "casa",
    label: "Casa Rebecca",
  },
  {
    description: "Hosted sample: ThatOpen school model",
    id: "demo",
    label: "Demo",
  },
];

const initialModelState = (): Record<string, ModelState> =>
  Object.fromEntries(
    MODELS.map((model) => [
      model.id,
      {
        bytesLoaded: 0,
        bytesTotal: 0,
        percent: 0,
        status: "idle" as ModelStatus,
      },
    ]),
  );

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const statusLabel = (status: ModelStatus) => {
  if (status === "idle") return "Ready";
  if (status === "streaming") return "Streaming";
  if (status === "loaded") return "Loaded";
  return "Error";
};

async function streamModel(
  url: string,
  onProgress: (bytesLoaded: number, bytesTotal: number) => void,
  getAuthToken?: () => Promise<string | null>,
) {
  const token = getAuthToken ? await getAuthToken() : null;
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Could not stream ${url}`);
  }

  const bytesTotal = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesLoaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    bytesLoaded += value.byteLength;
    onProgress(bytesLoaded, bytesTotal);
  }

  const buffer = new Uint8Array(bytesLoaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  onProgress(bytesLoaded, bytesTotal || bytesLoaded);
  return buffer.buffer;
}

export default function BimStreamer({
  controlSlot,
  getAuthToken,
}: BimStreamerProps = {}) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const initialLoadStartedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [modelStates, setModelStates] = useState(initialModelState);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<ProjectId>("casa");

  const activeProject = PROJECTS.find(
    (project) => project.id === activeProjectId,
  )!;

  const currentModels = useMemo(
    () => MODELS.filter((model) => model.project === activeProjectId),
    [activeProjectId],
  );

  const activeCount = useMemo(
    () =>
      currentModels.filter((model) => modelStates[model.id].status === "loaded")
        .length,
    [currentModels, modelStates],
  );

  const activeModel = activeModelId
    ? MODELS.find((model) => model.id === activeModelId)
    : null;

  const isStreamingAny = Object.values(modelStates).some(
    (state) => state.status === "streaming",
  );

  const streamStatus = currentModels.some(
    (model) => modelStates[model.id].status === "error",
  )
    ? "Needs attention"
    : isStreamingAny
      ? "Streaming"
      : activeCount
        ? "Ready"
        : "Idle";

  useEffect(() => {
    let cancelled = false;

    const initViewer = async () => {
      if (!viewerRef.current) return;

      try {
        const [OBC, THREE] = await Promise.all([
          import("@thatopen/components"),
          import("three"),
        ]);
        const components = new OBC.Components();
        const worlds = components.get(OBC.Worlds);
        const world = worlds.create<
          InstanceType<typeof OBC.SimpleScene>,
          InstanceType<typeof OBC.OrthoPerspectiveCamera>,
          InstanceType<typeof OBC.SimpleRenderer>
        >();

        world.scene = new OBC.SimpleScene(components);
        world.scene.setup();
        world.scene.three.background = new THREE.Color("#e4e9e2");
        world.renderer = new OBC.SimpleRenderer(components, viewerRef.current, {
          antialias: true,
          alpha: false,
        });
        world.renderer.showLogo = false;
        world.camera = new OBC.OrthoPerspectiveCamera(components);
        await world.camera.controls.setLookAt(58, 22, -25, 13, 0, 4.2);

        components.init();
        components.get(OBC.Grids).create(world);

        const workerUrl = await OBC.FragmentsManager.getWorker();
        const fragments = components.get(OBC.FragmentsManager);
        fragments.init(workerUrl);

        world.camera.controls.addEventListener("update", () =>
          fragments.core.update(),
        );

        fragments.list.onItemSet.add(({ value: model }) => {
          model.useCamera(world.camera.three);
          world.scene.three.add(model.object);
          fragments.core.update(true);
        });

        fragments.core.models.materials.list.onItemSet.add(
          ({ value: material }) => {
            if (!("isLodMaterial" in material && material.isLodMaterial)) {
              material.polygonOffset = true;
              material.polygonOffsetUnits = 1;
              material.polygonOffsetFactor = 1;
            }
          },
        );

        if (cancelled) {
          components.dispose();
          return;
        }

        runtimeRef.current = { components, fragments };
        setIsReady(true);
      } catch (error) {
        setBootError(
          error instanceof Error ? error.message : "The BIM viewer failed.",
        );
      }
    };

    initViewer();

    return () => {
      cancelled = true;
      runtimeRef.current?.components.dispose();
      runtimeRef.current = null;
    };
  }, []);

  const setModelState = useCallback(
    (id: string, update: Partial<ModelState>) => {
      setModelStates((current) => ({
        ...current,
        [id]: {
          ...current[id],
          ...update,
        },
      }));
    },
    [],
  );

  const loadModel = useCallback(
    async (model: DemoModel) => {
      const runtime = runtimeRef.current;
      if (!runtime || modelStates[model.id].status === "streaming") return;
      if (!model.url) {
        setActiveModelId(model.id);
        setModelState(model.id, {
          error: model.disabledReason,
          status: "error",
        });
        return;
      }

      try {
        if (runtime.fragments.list.has(model.id)) {
          await runtime.fragments.core.disposeModel(model.id);
        }

        setActiveModelId(model.id);
        setModelState(model.id, {
          bytesLoaded: 0,
          bytesTotal: 0,
          error: undefined,
          percent: 0,
          status: "streaming",
        });

        const buffer = await streamModel(
          model.url,
          (bytesLoaded, bytesTotal) => {
            setModelState(model.id, {
              bytesLoaded,
              bytesTotal,
              percent: bytesTotal
                ? Math.min(100, Math.round((bytesLoaded / bytesTotal) * 100))
                : 0,
            });
          },
          getAuthToken,
        );
        const streamedBytes = buffer.byteLength;

        await runtime.fragments.core.load(buffer, { modelId: model.id });
        runtime.fragments.core.update(true);
        setModelState(model.id, {
          bytesLoaded: streamedBytes,
          bytesTotal: streamedBytes,
          percent: 100,
          status: "loaded",
        });
      } catch (error) {
        setModelState(model.id, {
          bytesLoaded: 0,
          bytesTotal: 0,
          error:
            error instanceof Error
              ? error.message
              : "This model could not be loaded.",
          percent: 0,
          status: "error",
        });
      }
    },
    [getAuthToken, modelStates, setModelState],
  );

  const unloadModel = async (model: DemoModel) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    if (runtime.fragments.list.has(model.id)) {
      await runtime.fragments.core.disposeModel(model.id);
      runtime.fragments.core.update(true);
    }

    setModelState(model.id, {
      bytesLoaded: 0,
      bytesTotal: 0,
      error: undefined,
      percent: 0,
      status: "idle",
    });
  };

  const unloadAllModels = async () => {
    const runtime = runtimeRef.current;
    if (runtime) {
      for (const model of MODELS) {
        if (runtime.fragments.list.has(model.id)) {
          await runtime.fragments.core.disposeModel(model.id);
        }
      }
      runtime.fragments.core.update(true);
    }

    setActiveModelId(null);
    setModelStates(initialModelState());
  };

  const switchProject = async (project: ProjectId) => {
    if (project === activeProjectId) return;
    await unloadAllModels();
    setActiveProjectId(project);
  };

  const loadAll = useCallback(async () => {
    for (const model of currentModels) {
      if (!model.url) continue;
      if (modelStates[model.id].status !== "loaded") {
        await loadModel(model);
      }
    }
  }, [currentModels, loadModel, modelStates]);

  useEffect(() => {
    if (
      !isReady ||
      activeProjectId !== "casa" ||
      initialLoadStartedRef.current
    ) {
      return;
    }

    initialLoadStartedRef.current = true;
    void loadAll();
  }, [activeProjectId, isReady, loadAll]);

  return (
    <main className="dashboard-app">
      <aside className="app-sidebar" aria-label="Project navigation">
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            <Building2 className="icon" />
          </div>
          <div>
            <span>Evercam BIM</span>
            <strong>Casa Rebecca</strong>
          </div>
        </div>

        <nav className="sidebar-nav">
          <a
            className="sidebar-nav-item sidebar-nav-item-active"
            href="#dashboard-main"
          >
            <LayoutDashboard className="icon" aria-hidden="true" />
            Dashboard
          </a>
          <a className="sidebar-nav-item" href="#model-set">
            <Layers3 className="icon" aria-hidden="true" />
            Models
          </a>
          <a className="sidebar-nav-item" href="#stream-viewer">
            <Database className="icon" aria-hidden="true" />
            Streams
          </a>
          <a className="sidebar-nav-item" href="#access-controls">
            <ShieldCheck className="icon" aria-hidden="true" />
            Access
          </a>
        </nav>

        <section className="sidebar-projects" aria-label="Projects">
          <span>Projects</span>
          <div className="project-list">
            {PROJECTS.map((project) => (
              <button
                aria-pressed={activeProjectId === project.id}
                className="project-button"
                key={project.id}
                onClick={() => void switchProject(project.id)}
                type="button"
              >
                {project.id === "casa" ? (
                  <Building2 className="icon" aria-hidden="true" />
                ) : (
                  <Layers3 className="icon" aria-hidden="true" />
                )}
                <span>
                  <strong>{project.label}</strong>
                  <small>{project.description}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="sidebar-footer" id="access-controls">
          {controlSlot ? (
            <div className="control-slot">{controlSlot}</div>
          ) : null}
        </div>
      </aside>

      <section
        className="dashboard-main"
        id="dashboard-main"
        aria-label="BIM dashboard"
      >
        <section className="project-grid">
          <section
            className="viewer-card"
            id="stream-viewer"
            aria-label="BIM stream viewer"
          >
            <div className="viewer-toolbar">
              <div>
                <span>Viewport</span>
                <strong>{activeModel?.name ?? "Casa Rebecca"}</strong>
              </div>
              <span className={`status-badge status-${streamStatus.toLowerCase().replace(" ", "-")}`}>
                {streamStatus}
              </span>
            </div>

            <div className="viewer-surface" ref={viewerRef}>
              {!isReady ? (
                <div className="viewer-state">
                  {bootError ? (
                    <TriangleAlert className="icon-lg" aria-hidden="true" />
                  ) : (
                    <LoaderCircle className="icon-lg spin" aria-hidden="true" />
                  )}
                  <span>{bootError ?? "Starting ThatOpen viewer..."}</span>
                </div>
              ) : null}
            </div>
          </section>

          <aside
            className="models-panel"
            id="model-set"
            aria-label="Model streaming controls"
          >
            <div className="panel-header">
              <div>
                <span>Project</span>
                <h2>{activeProject.label}</h2>
              </div>
            </div>

            <div className="model-table">
              <div className="model-table-head">
                <span>Model</span>
                <span>Status</span>
                <span>Action</span>
              </div>

              {currentModels.map((model) => {
                const state = modelStates[model.id];
                const isLoaded = state.status === "loaded";
                const isStreaming = state.status === "streaming";
                const isActive = activeModelId === model.id;
                const isBlocked = !model.url;

                return (
                  <article
                    className={`model-table-row ${
                      isActive ? "model-table-row-active" : ""
                    } ${isBlocked ? "model-table-row-blocked" : ""}`}
                    key={model.id}
                  >
                    <div className="model-identity">
                      <div className="model-icon" aria-hidden="true">
                        {state.status === "loaded" ? (
                          <CircleCheck className="icon" />
                        ) : state.status === "streaming" ? (
                          <LoaderCircle className="icon spin" />
                        ) : state.status === "error" || isBlocked ? (
                          <TriangleAlert className="icon" />
                        ) : (
                          <Building2 className="icon" />
                        )}
                      </div>
                      <div>
                        <h3>{model.name}</h3>
                        <p>{model.description}</p>
                        <small>
                          {model.size} · {model.sourceFormat}
                        </small>
                      </div>
                    </div>

                    <div className="model-status-cell">
                      <span className={`status-badge status-${state.status}`}>
                        {isBlocked ? "Blocked" : statusLabel(state.status)}
                      </span>
                      <div className="progress-track">
                        <span style={{ width: `${state.percent}%` }} />
                      </div>
                      <small>
                        {isBlocked
                          ? "Not streamable"
                          : state.bytesLoaded
                            ? `${formatBytes(state.bytesLoaded)} streamed`
                            : "Ready"}
                      </small>
                    </div>

                    <button
                      className="row-action"
                      disabled={!isReady || isStreaming || isBlocked}
                      onClick={() =>
                        void (isLoaded ? unloadModel(model) : loadModel(model))
                      }
                      type="button"
                    >
                      {isBlocked
                        ? "Needs IFC"
                        : isLoaded
                          ? "Unload"
                          : isStreaming
                            ? "Streaming"
                            : "Load"}
                    </button>

                    {state.error || model.disabledReason ? (
                      <p className="error-text">
                        {state.error ?? model.disabledReason}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </aside>
        </section>
      </section>
    </main>
  );
}
