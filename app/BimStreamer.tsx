"use client";

import {
  Box,
  Building2,
  Layers3,
  LoaderCircle,
  Settings,
  SquareStack,
  TriangleAlert,
} from "lucide-react";
import type {
  FragmentsManager,
  ModelIdMap,
  OrthoPerspectiveCamera,
  SimpleRenderer,
  SimpleScene,
  TechnicalDrawing,
  TechnicalDrawings,
  World,
} from "@thatopen/components";
import type { FragmentsModel } from "@thatopen/fragments";
import type * as THREE from "three";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PROTECTED_MODEL_CATALOG } from "../modelCatalog";

type ModelStatus = "idle" | "streaming" | "loaded" | "error";

type ProjectId = "demo" | (typeof PROTECTED_MODEL_CATALOG)[number]["id"];

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
  OBC: typeof import("@thatopen/components");
  THREE: typeof import("three");
  components: { dispose: () => void; get: <T>(component: unknown) => T };
  fragments: FragmentsManager;
  projectionDrawing: TechnicalDrawing | null;
  projectionKey: string | null;
  world: World & {
    camera: OrthoPerspectiveCamera;
    renderer: SimpleRenderer;
    scene: SimpleScene;
  };
};

type BimStreamerProps = {
  controlSlot?: ReactNode;
  getAuthToken?: () => Promise<string | null>;
  isSettingsOpen?: boolean;
  onSettingsToggle?: () => void;
  settingsSlot?: ReactNode;
};

const DEMO_MODELS: DemoModel[] = [
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
];

const PROTECTED_MODELS: DemoModel[] = PROTECTED_MODEL_CATALOG.map((model) => ({
  description: `${model.sourceFileName} converted to Fragments`,
  id: model.id,
  name: model.projectName,
  project: model.id,
  sourceFormat: "Fragments",
  size: model.size,
  url: `/api/models/${model.id}`,
}));

const MODELS: DemoModel[] = [...PROTECTED_MODELS, ...DEMO_MODELS];

const DEFAULT_CAMERA_VIEW = {
  position: [58, 22, -25],
  target: [13, 0, 4.2],
} as const;

const PROJECTION_LAYERS = {
  hidden: "projection-hidden",
  visible: "projection-visible",
} as const;

const APP_NAME = "Evercam Open";

const PROJECTS: Array<{
  description: string;
  id: ProjectId;
  label: string;
}> = [
  ...PROTECTED_MODEL_CATALOG.map((model) => ({
    description: model.description,
    id: model.id,
    label: model.projectName,
  })),
  {
    description: "Hosted sample: ThatOpen school model",
    id: "demo",
    label: "Demo",
  },
];

function getLoadedProjectModels(runtime: Runtime, models: DemoModel[]) {
  return models
    .map((model) => runtime.fragments.list.get(model.id))
    .filter((model): model is FragmentsModel => Boolean(model));
}

function getLoadedModelIds(runtime: Runtime, models: DemoModel[]) {
  return models
    .filter((model) => runtime.fragments.list.has(model.id))
    .map((model) => model.id)
    .sort();
}

function setProjectModelsVisible(
  runtime: Runtime,
  models: DemoModel[],
  visible: boolean,
) {
  for (const model of getLoadedProjectModels(runtime, models)) {
    model.object.visible = visible;
  }

  runtime.fragments.core.update(true);
}

function getProjectModelBounds(runtime: Runtime, models: DemoModel[]) {
  const bounds = new runtime.THREE.Box3();

  for (const model of getLoadedProjectModels(runtime, models)) {
    model.object.updateWorldMatrix(true, true);
    bounds.expandByObject(model.object);
  }

  return bounds.isEmpty() ? null : bounds;
}

function collectProjectMeshes(runtime: Runtime, models: DemoModel[]) {
  const meshes: THREE.Mesh[] = [];

  for (const model of getLoadedProjectModels(runtime, models)) {
    model.object.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        meshes.push(object as THREE.Mesh);
      }
    });
  }

  return meshes;
}

async function getProjectModelIdMap(runtime: Runtime, models: DemoModel[]) {
  const modelIdMap: ModelIdMap = {};

  for (const model of models) {
    const fragmentModel = runtime.fragments.list.get(model.id);
    if (!fragmentModel) continue;

    const localIds = await fragmentModel.getItemsIdsWithGeometry();
    modelIdMap[model.id] = new Set(localIds);
  }

  return modelIdMap;
}

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
  isSettingsOpen = false,
  onSettingsToggle,
  settingsSlot,
}: BimStreamerProps = {}) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const lastLoadRequestRef = useRef<{
    projectId: ProjectId;
    requestId: number;
  } | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [modelStates, setModelStates] = useState(initialModelState);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] =
    useState<ProjectId>("casa_rebecca");
  const [loadRequestId, setLoadRequestId] = useState(0);
  const [is2DView, setIs2DView] = useState(false);
  const [isProjecting2D, setIsProjecting2D] = useState(false);
  const [projectionError, setProjectionError] = useState<string | null>(null);

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

  const canToggle2D = isReady && activeCount > 0 && !isStreamingAny;
  const displayedStreamStatus = isProjecting2D ? "Projecting 2D" : streamStatus;
  const displayedStreamStatusClass = isProjecting2D
    ? "streaming"
    : streamStatus.toLowerCase().replace(" ", "-");

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
        await world.camera.controls.setLookAt(
          ...DEFAULT_CAMERA_VIEW.position,
          ...DEFAULT_CAMERA_VIEW.target,
        );

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

        runtimeRef.current = {
          OBC,
          THREE,
          components,
          fragments,
          projectionDrawing: null,
          projectionKey: null,
          world,
        };
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

  const clearProjectionDrawing = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    runtime.projectionDrawing?.dispose();
    runtime.projectionDrawing = null;
    runtime.projectionKey = null;
  }, []);

  const ensureProjectionDrawing = useCallback(
    async (runtime: Runtime) => {
      const loadedModelIds = getLoadedModelIds(runtime, currentModels);
      if (!loadedModelIds.length) {
        throw new Error("Load a model before switching to 2D.");
      }

      const projectionKey = loadedModelIds.join("|");
      const bounds = getProjectModelBounds(runtime, currentModels);
      if (runtime.projectionDrawing && runtime.projectionKey === projectionKey) {
        return { bounds, drawing: runtime.projectionDrawing };
      }

      runtime.projectionDrawing?.dispose();
      runtime.projectionDrawing = null;
      runtime.projectionKey = null;

      const drawing = runtime.components
        .get<TechnicalDrawings>(runtime.OBC.TechnicalDrawings)
        .create(runtime.world);
      drawing.three.visible = false;
      drawing.orientTo(new runtime.THREE.Vector3(0, -1, 0));

      if (bounds) {
        const center = bounds.getCenter(new runtime.THREE.Vector3());
        const size = bounds.getSize(new runtime.THREE.Vector3());
        const topMargin = Math.max(size.y * 0.06, 0.5);
        drawing.three.position.set(center.x, bounds.max.y + topMargin, center.z);
        drawing.far = Math.max(size.y + topMargin * 2, 20);
      }

      drawing.layers.create(PROJECTION_LAYERS.visible, {
        material: new runtime.THREE.LineBasicMaterial({
          color: 0x17211d,
          depthTest: false,
        }),
      });
      drawing.layers.create(PROJECTION_LAYERS.hidden, {
        material: new runtime.THREE.LineBasicMaterial({
          color: 0x8a8f98,
          depthTest: false,
          opacity: 0.36,
          transparent: true,
        }),
      });

      await drawing.addProjectionFromItems(
        await getProjectModelIdMap(runtime, currentModels),
        {
          layers: PROJECTION_LAYERS,
        },
      );

      runtime.projectionDrawing = drawing;
      runtime.projectionKey = projectionKey;
      return { bounds, drawing };
    },
    [currentModels],
  );

  const switchViewMode = useCallback(
    async (nextIs2DView: boolean) => {
      const runtime = runtimeRef.current;
      if (!runtime || isProjecting2D) return;

      setProjectionError(null);

      if (!nextIs2DView) {
        setProjectModelsVisible(runtime, currentModels, true);
        if (runtime.projectionDrawing) {
          runtime.projectionDrawing.three.visible = false;
        }

        runtime.world.camera.set("Orbit");
        await runtime.world.camera.projection.set("Perspective");
        await runtime.world.camera.controls.setLookAt(
          ...DEFAULT_CAMERA_VIEW.position,
          ...DEFAULT_CAMERA_VIEW.target,
          true,
        );
        runtime.fragments.core.update(true);
        setIs2DView(false);
        return;
      }

      setIsProjecting2D(true);

      try {
        const loadedModelIds = getLoadedModelIds(runtime, currentModels);
        if (!loadedModelIds.length) {
          throw new Error("Load a model before switching to 2D.");
        }

        setIs2DView(true);
        const bounds = getProjectModelBounds(runtime, currentModels);
        const center = bounds?.getCenter(new runtime.THREE.Vector3());
        const size = bounds?.getSize(new runtime.THREE.Vector3());
        const viewSize = size ? Math.max(size.x, size.y, size.z, 24) : 40;

        setProjectModelsVisible(runtime, currentModels, true);
        if (runtime.projectionDrawing) {
          runtime.projectionDrawing.three.visible = false;
        }

        await runtime.world.camera.projection.set("Orthographic");
        runtime.world.camera.set("Plan");
        if (center) {
          await runtime.world.camera.controls.setLookAt(
            center.x,
            center.y + viewSize * 1.75,
            center.z,
            center.x,
            center.y,
            center.z,
            true,
          );
        }

        const meshes = collectProjectMeshes(runtime, currentModels);
        if (meshes.length) {
          await runtime.world.camera.fit(meshes, 1.25);
        }

        const { drawing } = await ensureProjectionDrawing(runtime);
        setProjectModelsVisible(runtime, currentModels, false);
        drawing.three.visible = true;
        runtime.fragments.core.update(true);
      } catch (error) {
        setProjectModelsVisible(runtime, currentModels, true);
        if (runtime.projectionDrawing) {
          runtime.projectionDrawing.three.visible = false;
        }
        runtime.world.camera.set("Orbit");
        await runtime.world.camera.projection.set("Perspective");
        await runtime.world.camera.controls.setLookAt(
          ...DEFAULT_CAMERA_VIEW.position,
          ...DEFAULT_CAMERA_VIEW.target,
          true,
        );
        setProjectionError(
          error instanceof Error
            ? error.message
            : "The 2D projection could not be generated.",
        );
        setIs2DView(false);
      } finally {
        setIsProjecting2D(false);
      }
    },
    [currentModels, ensureProjectionDrawing, isProjecting2D],
  );

  const loadModel = useCallback(
    async (model: DemoModel) => {
      const runtime = runtimeRef.current;
      if (!runtime || modelStates[model.id].status === "streaming") return;
      clearProjectionDrawing();
      setIs2DView(false);
      setProjectionError(null);

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
    [clearProjectionDrawing, getAuthToken, modelStates, setModelState],
  );

  const unloadAllModels = async () => {
    const runtime = runtimeRef.current;
    if (runtime) {
      clearProjectionDrawing();
      setIs2DView(false);
      setProjectionError(null);

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
    if (project !== activeProjectId) {
      await unloadAllModels();
      setActiveProjectId(project);
    }

    setLoadRequestId((requestId) => requestId + 1);
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
    if (!isReady) {
      return;
    }

    if (
      lastLoadRequestRef.current?.projectId === activeProjectId &&
      lastLoadRequestRef.current.requestId === loadRequestId
    ) {
      return;
    }

    const hasModelToLoad = currentModels.some((model) => {
      const status = modelStates[model.id].status;
      return model.url && status !== "loaded" && status !== "streaming";
    });

    if (!hasModelToLoad) {
      return;
    }

    lastLoadRequestRef.current = {
      projectId: activeProjectId,
      requestId: loadRequestId,
    };
    const timeoutId = window.setTimeout(() => {
      void loadAll();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeProjectId,
    currentModels,
    isReady,
    loadAll,
    loadRequestId,
    modelStates,
  ]);

  return (
    <main className="dashboard-app">
      <aside className="app-sidebar" aria-label="Project navigation">
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            <Building2 className="icon" />
          </div>
          <div>
            <span>Evercam BIM</span>
            <strong>{APP_NAME}</strong>
          </div>
        </div>

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
                {project.id === "demo" ? (
                  <Layers3 className="icon" aria-hidden="true" />
                ) : (
                  <Building2 className="icon" aria-hidden="true" />
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
        <section
          className={`project-grid${isSettingsOpen && settingsSlot ? " has-settings" : ""}`}
        >
          <section
            className="viewer-card"
            id="stream-viewer"
            aria-label="BIM stream viewer"
          >
            <div className="viewer-toolbar">
              <div className="viewer-toolbar-title">
                <span>Viewport</span>
                <strong>{activeModel?.name ?? "Casa Rebecca"}</strong>
              </div>
              <div className="viewer-toolbar-actions">
                <button
                  aria-label={
                    is2DView
                      ? "Switch to 3D view"
                      : "Switch to 2D projection view"
                  }
                  aria-pressed={is2DView}
                  className="view-mode-toggle"
                  disabled={!canToggle2D || isProjecting2D}
                  onClick={() => void switchViewMode(!is2DView)}
                  title={is2DView ? "3D view" : "2D projection view"}
                  type="button"
                >
                  {isProjecting2D ? (
                    <LoaderCircle className="icon spin" aria-hidden="true" />
                  ) : is2DView ? (
                    <Box className="icon" aria-hidden="true" />
                  ) : (
                    <SquareStack className="icon" aria-hidden="true" />
                  )}
                  <span className="view-mode-label">
                    {is2DView ? "3D" : "2D"}
                  </span>
                </button>
                {settingsSlot ? (
                  <button
                    aria-label="Settings"
                    aria-pressed={isSettingsOpen}
                    className="settings-toggle"
                    onClick={onSettingsToggle}
                    title="Settings"
                    type="button"
                  >
                    <Settings className="icon" aria-hidden="true" />
                  </button>
                ) : null}
                <span
                  className={`status-badge status-${displayedStreamStatusClass}`}
                >
                  {displayedStreamStatus}
                </span>
              </div>
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
              {projectionError ? (
                <div className="viewer-alert" role="status">
                  <TriangleAlert className="icon" aria-hidden="true" />
                  <span>{projectionError}</span>
                </div>
              ) : null}
            </div>
          </section>

          {isSettingsOpen && settingsSlot ? (
            <section className="settings-panel" aria-label="Settings">
              {settingsSlot}
            </section>
          ) : null}
        </section>
      </section>
    </main>
  );
}
