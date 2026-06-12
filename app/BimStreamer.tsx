"use client";

import {
  Box,
  Building2,
  Layers3,
  LoaderCircle,
  Settings,
  SquareStack,
  TriangleAlert,
  UsersRound,
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
import ProjectSettings, { type ProjectSetting } from "./ProjectSettings";

type ModelStatus = "idle" | "streaming" | "loaded" | "error";

type ProjectId = "demo" | (typeof PROTECTED_MODEL_CATALOG)[number]["id"];
type DashboardSection = "application-settings" | "viewer";
type ViewMode = "2d" | "3d";
type HistoryUpdateMode = "push" | "replace";

type VectorRouteValue = [number, number, number];

type CameraRouteState = {
  position: VectorRouteValue;
  target: VectorRouteValue;
};

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

type CameraControlsRouteAdapter = {
  getPosition?: (
    out: THREE.Vector3,
    receiveEndValue?: boolean,
  ) => THREE.Vector3;
  getTarget?: (
    out: THREE.Vector3,
    receiveEndValue?: boolean,
  ) => THREE.Vector3;
  toJSON?: () => string;
};

type BrowserRouteState = {
  camera: CameraRouteState | null;
  modelId: string | null;
  projectId: ProjectId;
  section: DashboardSection;
  viewMode: ViewMode;
};

type BimStreamerProps = {
  applicationSettingsSlot?: ReactNode;
  canManageProjectSettings?: boolean;
  controlSlot?: ReactNode;
  getAuthToken?: () => Promise<string | null>;
  isProjectSettingsOpen?: boolean;
  onProjectNameSaved?: (project: ProjectSetting) => void;
  onProjectSettingsToggle?: () => void;
  projectSettings?: Record<string, ProjectSetting>;
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
const EMPTY_PROJECT_SETTINGS: Record<string, ProjectSetting> = {};

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

const DEFAULT_PROJECT_ID: ProjectId = "casa_rebecca";
const DEFAULT_VIEW_MODE: ViewMode = "3d";
const CAMERA_ROUTE_UPDATE_DELAY_MS = 400;
const ROUTE_PARAMS = {
  camera: "camera",
  model: "model",
  project: "project",
  section: "section",
  target: "target",
  view: "view",
} as const;

function isProjectId(value: string | null): value is ProjectId {
  return Boolean(value && PROJECTS.some((project) => project.id === value));
}

function getRouteModel(modelId: string | null) {
  return modelId ? MODELS.find((model) => model.id === modelId) : undefined;
}

function getRouteModelId(modelId: string | null, projectId: ProjectId) {
  const model = getRouteModel(modelId);
  return model?.project === projectId ? model.id : null;
}

function parseVectorRouteValue(value: string | null): VectorRouteValue | null {
  if (!value) return null;

  const numbers = value.split(",").map((part) => Number(part));
  if (numbers.length !== 3 || numbers.some((number) => !Number.isFinite(number))) {
    return null;
  }

  return numbers as VectorRouteValue;
}

function serializeVectorRouteValue(value: VectorRouteValue) {
  return value.map((number) => Number(number.toFixed(3))).join(",");
}

function parseRouteState(): BrowserRouteState {
  const fallback: BrowserRouteState = {
    camera: null,
    modelId: null,
    projectId: DEFAULT_PROJECT_ID,
    section: "viewer",
    viewMode: DEFAULT_VIEW_MODE,
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  const params = new URLSearchParams(window.location.search);
  const routeProjectId = params.get(ROUTE_PARAMS.project);
  const routeModel = getRouteModel(params.get(ROUTE_PARAMS.model));
  const projectId = isProjectId(routeProjectId)
    ? routeProjectId
    : (routeModel?.project ?? DEFAULT_PROJECT_ID);
  const position = parseVectorRouteValue(params.get(ROUTE_PARAMS.camera));
  const target = parseVectorRouteValue(params.get(ROUTE_PARAMS.target));

  return {
    camera: position && target ? { position, target } : null,
    modelId: getRouteModelId(routeModel?.id ?? null, projectId),
    projectId,
    section:
      params.get(ROUTE_PARAMS.section) === "application-settings"
        ? "application-settings"
        : "viewer",
    viewMode: params.get(ROUTE_PARAMS.view) === "2d" ? "2d" : "3d",
  };
}

function writeRouteState(
  routeState: BrowserRouteState,
  updateMode: HistoryUpdateMode,
) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.searchParams.set(ROUTE_PARAMS.project, routeState.projectId);
  url.searchParams.set(ROUTE_PARAMS.view, routeState.viewMode);

  if (routeState.section === "application-settings") {
    url.searchParams.set(ROUTE_PARAMS.section, routeState.section);
  } else {
    url.searchParams.delete(ROUTE_PARAMS.section);
  }

  if (routeState.modelId) {
    url.searchParams.set(ROUTE_PARAMS.model, routeState.modelId);
  } else {
    url.searchParams.delete(ROUTE_PARAMS.model);
  }

  if (routeState.camera) {
    url.searchParams.set(
      ROUTE_PARAMS.camera,
      serializeVectorRouteValue(routeState.camera.position),
    );
    url.searchParams.set(
      ROUTE_PARAMS.target,
      serializeVectorRouteValue(routeState.camera.target),
    );
  } else {
    url.searchParams.delete(ROUTE_PARAMS.camera);
    url.searchParams.delete(ROUTE_PARAMS.target);
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (nextUrl === currentUrl) return;

  if (updateMode === "push") {
    window.history.pushState(routeState, "", nextUrl);
  } else {
    window.history.replaceState(routeState, "", nextUrl);
  }
}

function isVectorRouteValue(value: unknown): value is VectorRouteValue {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((number) => typeof number === "number" && Number.isFinite(number))
  );
}

function getCameraRouteState(
  runtime: Runtime,
  visibleModels: DemoModel[],
): CameraRouteState {
  const controls = runtime.world.camera.controls as CameraControlsRouteAdapter;
  if (controls.getPosition && controls.getTarget) {
    const position = controls.getPosition(new runtime.THREE.Vector3(), true);
    const target = controls.getTarget(new runtime.THREE.Vector3(), true);

    return {
      position: [position.x, position.y, position.z],
      target: [target.x, target.y, target.z],
    };
  }

  try {
    const serializedControls =
      typeof controls.toJSON === "function" ? JSON.parse(controls.toJSON()) : null;

    if (
      serializedControls &&
      isVectorRouteValue(serializedControls.position) &&
      isVectorRouteValue(serializedControls.target)
    ) {
      return {
        position: serializedControls.position,
        target: serializedControls.target,
      };
    }
  } catch {
    // Fall through to the camera and model-bounds fallback.
  }

  const position = runtime.world.camera.three.position;
  const target =
    getProjectModelBounds(runtime, visibleModels)?.getCenter(
      new runtime.THREE.Vector3(),
    ) ??
    new runtime.THREE.Vector3(
      ...DEFAULT_CAMERA_VIEW.target,
    );

  return {
    position: [position.x, position.y, position.z],
    target: [target.x, target.y, target.z],
  };
}

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
  applicationSettingsSlot,
  canManageProjectSettings = false,
  controlSlot,
  getAuthToken,
  isProjectSettingsOpen = false,
  onProjectNameSaved,
  onProjectSettingsToggle,
  projectSettings = EMPTY_PROJECT_SETTINGS,
}: BimStreamerProps = {}) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const lastLoadRequestRef = useRef<{
    projectId: ProjectId;
    requestId: number;
  } | null>(null);
  const cameraRouteTimerRef = useRef<number | null>(null);
  const routeWriteModeRef = useRef<HistoryUpdateMode>("replace");
  const pendingRouteCameraRef = useRef<CameraRouteState | null>(null);
  const pendingRouteViewModeRef = useRef<ViewMode | null>(null);
  const suppressNextRouteWriteRef = useRef(false);
  const canShowApplicationSettings = Boolean(applicationSettingsSlot);
  const [isReady, setIsReady] = useState(false);
  const [hasAppliedInitialRoute, setHasAppliedInitialRoute] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [activeSection, setActiveSection] =
    useState<DashboardSection>("viewer");
  const [modelStates, setModelStates] = useState(initialModelState);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] =
    useState<ProjectId>(DEFAULT_PROJECT_ID);
  const [loadRequestId, setLoadRequestId] = useState(0);
  const [is2DView, setIs2DView] = useState(false);
  const [isProjecting2D, setIsProjecting2D] = useState(false);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const [cameraRouteVersion, setCameraRouteVersion] = useState(0);

  const resolvedProjects = useMemo(
    () =>
      PROJECTS.map((project) => ({
        ...project,
        label: projectSettings[project.id]?.name ?? project.label,
      })),
    [projectSettings],
  );

  const resolvedModels = useMemo(
    () =>
      MODELS.map((model) =>
        model.project === "demo"
          ? model
          : {
              ...model,
              name: projectSettings[model.project]?.name ?? model.name,
            },
      ),
    [projectSettings],
  );

  const currentModels = useMemo(
    () => resolvedModels.filter((model) => model.project === activeProjectId),
    [activeProjectId, resolvedModels],
  );

  const activeCount = useMemo(
    () =>
      currentModels.filter((model) => modelStates[model.id].status === "loaded")
        .length,
    [currentModels, modelStates],
  );

  const activeModel = activeModelId
    ? resolvedModels.find((model) => model.id === activeModelId)
    : null;

  const activeProject = resolvedProjects.find(
    (project) => project.id === activeProjectId,
  );

  const activeProjectDefault = PROJECTS.find(
    (project) => project.id === activeProjectId,
  );

  const activeProjectSettings = activeProject
    ? {
        defaultName: activeProjectDefault?.label ?? activeProject.label,
        id: activeProject.id,
        name: activeProject.label,
        updatedAt: projectSettings[activeProject.id]?.updatedAt ?? null,
        updatedBy: projectSettings[activeProject.id]?.updatedBy ?? null,
      }
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
  const canShowProjectSettings = Boolean(
    canManageProjectSettings &&
      getAuthToken &&
      onProjectNameSaved &&
      activeProjectSettings,
  );

  const queueCameraRouteUpdate = useCallback(() => {
    if (typeof window === "undefined" || cameraRouteTimerRef.current) return;

    cameraRouteTimerRef.current = window.setTimeout(() => {
      cameraRouteTimerRef.current = null;
      setCameraRouteVersion((version) => version + 1);
    }, CAMERA_ROUTE_UPDATE_DELAY_MS);
  }, []);

  const commitCurrentRouteState = useCallback(
    (updateMode: HistoryUpdateMode = "replace") => {
      const runtime = runtimeRef.current;
      const camera = runtime
        ? getCameraRouteState(runtime, currentModels)
        : pendingRouteCameraRef.current;
      const modelId = getRouteModelId(activeModelId, activeProjectId);

      writeRouteState(
        {
          camera,
          modelId,
          projectId: activeProjectId,
          section: activeSection,
          viewMode: is2DView ? "2d" : "3d",
        },
        updateMode,
      );
    },
    [activeModelId, activeProjectId, activeSection, currentModels, is2DView],
  );

  const applyRouteCamera = useCallback(async (camera: CameraRouteState) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    await runtime.world.camera.controls.setLookAt(
      ...camera.position,
      ...camera.target,
      true,
    );
    runtime.fragments.core.update(true);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const routeState = parseRouteState();
      suppressNextRouteWriteRef.current = true;
      pendingRouteCameraRef.current = routeState.camera;
      pendingRouteViewModeRef.current =
        routeState.viewMode === "2d" ? "2d" : null;
      setActiveModelId(routeState.modelId);
      setActiveProjectId(routeState.projectId);
      setActiveSection(
        routeState.section === "application-settings" &&
          canShowApplicationSettings
          ? "application-settings"
          : "viewer",
      );
      setLoadRequestId((requestId) => requestId + 1);
      setHasAppliedInitialRoute(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [canShowApplicationSettings]);

  useEffect(() => {
    if (!hasAppliedInitialRoute) return;

    if (suppressNextRouteWriteRef.current) {
      suppressNextRouteWriteRef.current = false;
      return;
    }

    const updateMode = routeWriteModeRef.current;
    routeWriteModeRef.current = "replace";
    commitCurrentRouteState(updateMode);
  }, [
    activeModelId,
    activeProjectId,
    activeSection,
    cameraRouteVersion,
    commitCurrentRouteState,
    hasAppliedInitialRoute,
    is2DView,
  ]);

  useEffect(
    () => () => {
      if (cameraRouteTimerRef.current) {
        window.clearTimeout(cameraRouteTimerRef.current);
      }
    },
    [],
  );

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

        world.camera.controls.addEventListener("update", () => {
          fragments.core.update();
          queueCameraRouteUpdate();
        });

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
        queueCameraRouteUpdate();
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
  }, [queueCameraRouteUpdate]);

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
    async (
      nextIs2DView: boolean,
      historyUpdateMode?: HistoryUpdateMode,
    ) => {
      const runtime = runtimeRef.current;
      if (!runtime || isProjecting2D) return;

      if (historyUpdateMode) {
        routeWriteModeRef.current = historyUpdateMode;
      }

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
        setIs2DView(true);
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

  const unloadAllModels = useCallback(async () => {
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
  }, [clearProjectionDrawing]);

  const switchProject = async (project: ProjectId) => {
    if (project !== activeProjectId || activeSection !== "viewer") {
      routeWriteModeRef.current = "push";
    }

    setActiveSection("viewer");

    if (project !== activeProjectId) {
      await unloadAllModels();
      setActiveProjectId(project);
    }

    setLoadRequestId((requestId) => requestId + 1);
  };

  const openApplicationSettings = () => {
    if (!canShowApplicationSettings) return;

    routeWriteModeRef.current = "push";
    if (isProjectSettingsOpen) {
      onProjectSettingsToggle?.();
    }
    setActiveSection("application-settings");
  };

  const loadAll = useCallback(async () => {
    const preferredModelId = getRouteModelId(activeModelId, activeProjectId);

    for (const model of currentModels) {
      if (!model.url) continue;
      if (modelStates[model.id].status !== "loaded") {
        await loadModel(model);
      }
    }

    if (
      preferredModelId &&
      currentModels.some((model) => model.id === preferredModelId)
    ) {
      setActiveModelId(preferredModelId);
    }
  }, [activeModelId, activeProjectId, currentModels, loadModel, modelStates]);

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

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const routeState = parseRouteState();
      suppressNextRouteWriteRef.current = true;
      pendingRouteCameraRef.current = routeState.camera;
      pendingRouteViewModeRef.current = routeState.viewMode;
      setProjectionError(null);

      const applyRouteProject = async () => {
        if (routeState.projectId !== activeProjectId) {
          await unloadAllModels();
        }

        setActiveModelId(routeState.modelId);
        setActiveProjectId(routeState.projectId);
        setActiveSection(
          routeState.section === "application-settings" &&
            canShowApplicationSettings
            ? "application-settings"
            : "viewer",
        );
        setLoadRequestId((requestId) => requestId + 1);
      };

      void applyRouteProject();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [activeProjectId, canShowApplicationSettings, unloadAllModels]);

  useEffect(() => {
    const requestedViewMode = pendingRouteViewModeRef.current;
    if (!requestedViewMode || !isReady || isProjecting2D) return;

    if (requestedViewMode === "2d") {
      if (is2DView) {
        pendingRouteViewModeRef.current = null;
        return;
      }

      if (!canToggle2D) return;

      pendingRouteViewModeRef.current = null;
      const timeoutId = window.setTimeout(() => {
        void switchViewMode(true);
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    pendingRouteViewModeRef.current = null;
    if (is2DView) {
      const timeoutId = window.setTimeout(() => {
        void switchViewMode(false);
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
  }, [canToggle2D, is2DView, isProjecting2D, isReady, switchViewMode]);

  useEffect(() => {
    const camera = pendingRouteCameraRef.current;
    if (!camera || !isReady) return;
    if (pendingRouteViewModeRef.current === "2d" && !is2DView) return;

    pendingRouteCameraRef.current = null;
    const timeoutId = window.setTimeout(() => {
      void applyRouteCamera(camera);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [activeCount, activeProjectId, applyRouteCamera, is2DView, isReady]);

  return (
    <main className="dashboard-app">
      <aside className="app-sidebar" aria-label="Project navigation">
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            <Building2 className="icon" />
          </div>
          <div>
            <span>Evercam Open</span>
          </div>
        </div>

        <section className="sidebar-projects" aria-label="Projects">
          <span>Projects</span>
          <div className="project-list">
            {resolvedProjects.map((project) => (
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
                  {project.description ? <small>{project.description}</small> : null}
                </span>
              </button>
            ))}
          </div>
        </section>

        {canShowApplicationSettings ? (
          <section
            className="sidebar-projects sidebar-admin"
            aria-label="Administration"
          >
            <span>Admin</span>
            <button
              aria-pressed={activeSection === "application-settings"}
              className="project-button"
              onClick={openApplicationSettings}
              type="button"
            >
              <UsersRound className="icon" aria-hidden="true" />
              <span>
                <strong>Application settings</strong>
                <small>Users and access</small>
              </span>
            </button>
          </section>
        ) : null}

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
          aria-hidden={activeSection !== "viewer"}
          className={`project-grid${isProjectSettingsOpen && canShowProjectSettings ? " has-settings" : ""}${activeSection === "viewer" ? "" : " is-background"}`}
        >
          <section
            className="viewer-card"
            id="stream-viewer"
            aria-label="BIM stream viewer"
          >
            <div className="viewer-toolbar">
              <div className="viewer-toolbar-title">
                <span>Viewport</span>
                <strong>{activeModel?.name ?? activeProject?.label ?? APP_NAME}</strong>
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
                  onClick={() => void switchViewMode(!is2DView, "push")}
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
                {canShowProjectSettings ? (
                  <button
                    aria-label="Project settings"
                    aria-pressed={isProjectSettingsOpen}
                    className="settings-toggle"
                    onClick={onProjectSettingsToggle}
                    title="Project settings"
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

          {isProjectSettingsOpen &&
          canShowProjectSettings &&
          getAuthToken &&
          onProjectNameSaved &&
          activeProjectSettings ? (
            <section className="settings-panel" aria-label="Project settings">
              <ProjectSettings
                getAuthToken={getAuthToken}
                key={activeProjectSettings.id}
                onSaved={onProjectNameSaved}
                project={activeProjectSettings}
              />
            </section>
          ) : null}
        </section>

        {activeSection === "application-settings" && applicationSettingsSlot ? (
          <section
            className="application-settings-view"
            aria-label="Application settings"
          >
            {applicationSettingsSlot}
          </section>
        ) : null}
      </section>
    </main>
  );
}
