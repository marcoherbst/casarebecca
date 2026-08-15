"use client";

import {
  Box,
  Building2,
  Footprints,
  GitBranch,
  Home,
  Layers3,
  ListTree,
  LoaderCircle,
  Orbit,
  Scissors,
  Settings,
  SquareStack,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import type {
  Clipper,
  FragmentsManager,
  ModelIdMap,
  OrthoPerspectiveCamera,
  SimpleRenderer,
  SimpleScene,
  TechnicalDrawing,
  TechnicalDrawings,
  View,
  Views,
  World,
} from "@thatopen/components";
import type { FragmentsModel, ItemData, RaycastResult } from "@thatopen/fragments";
// Resolved to a same-origin build asset URL by Vite (see the `?url` suffix),
// so the fragments worker no longer needs a network round trip to
// unpkg.com on every session — OBC.FragmentsManager.getWorker() fetches the
// version-matched worker from there by default, which this bypasses. Only
// the "./worker" subpath (-> dist/Worker/worker.mjs) is in the package's
// public exports map; the smaller worker.min.mjs isn't externally importable.
import fragmentsWorkerUrl from "@thatopen/fragments/worker?url";
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
import CategoryTree from "./CategoryTree";
import ElementInspector, { type SelectedElement } from "./ElementInspector";
import ProjectSettings, { type ProjectSetting } from "./ProjectSettings";

type ModelStatus = "idle" | "streaming" | "loaded" | "error";

type ProjectId = "demo" | (typeof PROTECTED_MODEL_CATALOG)[number]["id"];
type DashboardSection = "application-settings" | "home" | "viewer";
type ViewMode = "2d" | "3d";
type NavigationMode = "Orbit" | "FirstPerson";
type HistoryUpdateMode = "push" | "replace";
type ViewCatalogGroup = "Floor Plans" | "Elevations";

type ViewCatalogEntry = {
  group: ViewCatalogGroup;
  id: string;
  label: string;
};

type CategoryTreeEntry = {
  category: string;
  count: number;
  map: ModelIdMap;
  visible: boolean;
};

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

type InteractionState = {
  hoverBusy: boolean;
  hoveredKey: string | null;
  hoveredMap: ModelIdMap | null;
  selectedKey: string | null;
  selectedMap: ModelIdMap | null;
};

type Runtime = {
  FRAGS: typeof import("@thatopen/fragments");
  OBC: typeof import("@thatopen/components");
  THREE: typeof import("three");
  categoryTree: CategoryTreeEntry[];
  categoryTreeBuildKey: string | null;
  categoryTreeBuildPromise: Promise<CategoryTreeEntry[]> | null;
  categoryTreeModelsKey: string | null;
  clipper: Clipper;
  components: { dispose: () => void; get: <T>(component: unknown) => T };
  drawings: Map<string, TechnicalDrawing>;
  fragments: FragmentsManager;
  interaction: InteractionState;
  viewCatalog: ViewCatalogEntry[];
  viewCatalogBuildKey: string | null;
  viewCatalogBuildPromise: Promise<ViewCatalogEntry[]> | null;
  viewCatalogModelsKey: string | null;
  views: Views;
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
  view2dId: string | null;
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
  view2d: "view2d",
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
    section: "home",
    view2dId: null,
    viewMode: DEFAULT_VIEW_MODE,
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  const params = new URLSearchParams(window.location.search);
  const routeProjectId = params.get(ROUTE_PARAMS.project);
  const routeModel = getRouteModel(params.get(ROUTE_PARAMS.model));
  const hasExplicitProject = isProjectId(routeProjectId) || Boolean(routeModel);
  const projectId = isProjectId(routeProjectId)
    ? routeProjectId
    : (routeModel?.project ?? DEFAULT_PROJECT_ID);
  const position = parseVectorRouteValue(params.get(ROUTE_PARAMS.camera));
  const target = parseVectorRouteValue(params.get(ROUTE_PARAMS.target));
  const viewMode = params.get(ROUTE_PARAMS.view) === "2d" ? "2d" : "3d";
  const sectionParam = params.get(ROUTE_PARAMS.section);
  // A link that names a project (?project=... or ?model=...) always opens
  // straight into that project's viewer. Otherwise, land on the project
  // picker rather than silently opening whatever DEFAULT_PROJECT_ID is.
  const section: DashboardSection =
    sectionParam === "application-settings"
      ? "application-settings"
      : sectionParam === "home" && !hasExplicitProject
        ? "home"
        : hasExplicitProject
          ? "viewer"
          : "home";

  return {
    camera: position && target ? { position, target } : null,
    modelId: getRouteModelId(routeModel?.id ?? null, projectId),
    projectId,
    section,
    view2dId: viewMode === "2d" ? params.get(ROUTE_PARAMS.view2d) : null,
    viewMode,
  };
}

function writeRouteState(
  routeState: BrowserRouteState,
  updateMode: HistoryUpdateMode,
) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);

  if (routeState.section === "home") {
    // A clean "home" URL carries no project/model/view state, so landing on
    // it later (or reloading) shows the project picker again rather than
    // silently re-entering whatever project was last active.
    url.searchParams.set(ROUTE_PARAMS.section, "home");
    url.searchParams.delete(ROUTE_PARAMS.project);
    url.searchParams.delete(ROUTE_PARAMS.model);
    url.searchParams.delete(ROUTE_PARAMS.view);
    url.searchParams.delete(ROUTE_PARAMS.view2d);
    url.searchParams.delete(ROUTE_PARAMS.camera);
    url.searchParams.delete(ROUTE_PARAMS.target);

    const homeUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentHomeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (homeUrl === currentHomeUrl) return;

    if (updateMode === "push") {
      window.history.pushState(routeState, "", homeUrl);
    } else {
      window.history.replaceState(routeState, "", homeUrl);
    }
    return;
  }

  url.searchParams.set(ROUTE_PARAMS.project, routeState.projectId);
  url.searchParams.set(ROUTE_PARAMS.view, routeState.viewMode);

  if (routeState.section === "application-settings") {
    url.searchParams.set(ROUTE_PARAMS.section, routeState.section);
  } else {
    url.searchParams.delete(ROUTE_PARAMS.section);
  }

  if (routeState.viewMode === "2d" && routeState.view2dId) {
    url.searchParams.set(ROUTE_PARAMS.view2d, routeState.view2dId);
  } else {
    url.searchParams.delete(ROUTE_PARAMS.view2d);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resetViewCatalog(runtime: Runtime) {
  for (const drawing of runtime.drawings.values()) {
    drawing.dispose();
  }
  runtime.drawings.clear();
  runtime.views.list.clear();
  runtime.viewCatalog = [];
  runtime.viewCatalogModelsKey = null;
}

/**
 * Generates the app's standard 2D view set for the currently loaded models:
 * one floor plan per IFC building storey (falling back to a single overall
 * plan when storey metadata isn't available, e.g. the bundled demo models),
 * plus front/back/left/right elevations of the combined model bounds.
 */
async function buildViewCatalog(
  runtime: Runtime,
  models: DemoModel[],
): Promise<ViewCatalogEntry[]> {
  const { THREE, views } = runtime;
  resetViewCatalog(runtime);
  views.world = runtime.world;

  const loadedModelIds = getLoadedModelIds(runtime, models);
  if (!loadedModelIds.length) return [];

  const modelIdPattern = new RegExp(
    `^(?:${loadedModelIds.map(escapeRegExp).join("|")})$`,
  );
  const bounds = getProjectModelBounds(runtime, models);
  const catalog: ViewCatalogEntry[] = [];

  const storeyViews = await views.createFromIfcStoreys({
    modelIds: [modelIdPattern],
  });

  // Multi-discipline projects (e.g. architecture + structure) commonly reuse
  // the same storey names, so createFromIfcStoreys can hand back several
  // views per name — only the last-created one survives in views.list (later
  // ids overwrite earlier ones there), so dispose the rest to avoid orphaned
  // views and duplicate catalog entries.
  const uniqueStoreyViews = new Map<string, View>();
  for (const view of storeyViews) {
    const previous = uniqueStoreyViews.get(view.id);
    if (previous && previous !== view) {
      previous.dispose();
    }
    uniqueStoreyViews.set(view.id, view);
  }

  if (uniqueStoreyViews.size) {
    const sorted = [...uniqueStoreyViews.values()].sort(
      (a, b) => a.plane.constant - b.plane.constant,
    );

    sorted.forEach((view, index) => {
      const below = sorted[index - 1];
      const lowerBound = below
        ? below.plane.constant
        : (bounds?.min.y ?? view.plane.constant - 6);
      view.range = Math.max(view.plane.constant - lowerBound, 1);
      catalog.push({ group: "Floor Plans", id: view.id, label: view.id });
    });
  } else if (bounds) {
    const center = bounds.getCenter(new THREE.Vector3());
    const topPoint = new THREE.Vector3(center.x, bounds.max.y, center.z);
    const view = views.create(new THREE.Vector3(0, -1, 0), topPoint, {
      id: "Overall Plan",
    });
    view.range = Math.max(bounds.max.y - bounds.min.y, 6);
    catalog.push({ group: "Floor Plans", id: view.id, label: view.id });
  }

  const elevationViews = views.createElevations({
    combine: true,
    modelIds: [modelIdPattern],
  });
  for (const view of elevationViews) {
    catalog.push({ group: "Elevations", id: view.id, label: view.id });
  }

  runtime.viewCatalog = catalog;
  runtime.viewCatalogModelsKey = loadedModelIds.join("|");
  return catalog;
}

/**
 * Groups every loaded item by its IFC category (e.g. IFCWALL, IFCDOOR) across
 * all currently loaded models, for the category tree's visibility toggles.
 */
async function buildCategoryTree(
  runtime: Runtime,
  models: DemoModel[],
): Promise<CategoryTreeEntry[]> {
  const loadedModelIds = getLoadedModelIds(runtime, models);
  if (!loadedModelIds.length) return [];

  const byCategory = new Map<string, ModelIdMap>();

  for (const modelId of loadedModelIds) {
    const model = runtime.fragments.list.get(modelId);
    if (!model) continue;

    const itemsByCategory = await model.getItemsOfCategories([/.*/]);
    for (const [category, localIds] of Object.entries(itemsByCategory)) {
      if (!localIds.length) continue;
      const map = byCategory.get(category) ?? {};
      map[modelId] = new Set(localIds);
      byCategory.set(category, map);
    }
  }

  return [...byCategory.entries()]
    .map(([category, map]) => ({
      category,
      count: Object.values(map).reduce((sum, ids) => sum + ids.size, 0),
      map,
      visible: true,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function resetCategoryTree(runtime: Runtime) {
  runtime.categoryTree = [];
  runtime.categoryTreeModelsKey = null;
  runtime.categoryTreeBuildKey = null;
  runtime.categoryTreeBuildPromise = null;
}

async function ensureDrawingForView(
  runtime: Runtime,
  models: DemoModel[],
  view: View,
) {
  const cached = runtime.drawings.get(view.id);
  if (cached) return cached;

  const drawing = runtime.components
    .get<TechnicalDrawings>(runtime.OBC.TechnicalDrawings)
    .create(runtime.world);
  drawing.three.visible = false;
  drawing.orientTo(view.plane.normal.clone());
  drawing.three.position.copy(
    view.plane.normal.clone().multiplyScalar(-view.plane.constant),
  );
  drawing.far = Math.max(view.range, 1);

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
    await getProjectModelIdMap(runtime, models),
    { layers: PROJECTION_LAYERS },
  );

  runtime.drawings.set(view.id, drawing);
  return drawing;
}

const HOVER_COLOR = "#f2a93b";
const SELECT_COLOR = "#1f7a5c";

function buildHighlightStyle(runtime: Runtime, color: string) {
  return {
    color: new runtime.THREE.Color(color),
    opacity: 1,
    renderedFaces: runtime.FRAGS.RenderedFaces.TWO,
    transparent: false,
  };
}

/**
 * Fully-transparent highlight style used to "hide" a category. FragmentsModel's
 * own setVisible()/Hider component updates its internal visibility flag
 * correctly (confirmed via getVisible()), but that change doesn't reliably
 * propagate to already-rendered tiles in this fragments version — the mesh
 * stays on screen. A transparent highlight material, by contrast, is proven
 * to repaint immediately (same mechanism as hover/selection), so category
 * visibility is implemented as a highlight instead of a real geometry hide.
 */
function buildHiddenStyle(runtime: Runtime) {
  return {
    color: new runtime.THREE.Color("#ffffff"),
    opacity: 0,
    renderedFaces: runtime.FRAGS.RenderedFaces.TWO,
    transparent: true,
  };
}

function raycastKey(result: RaycastResult) {
  return `${result.fragments.modelId}:${result.localId}`;
}

function raycastMap(result: RaycastResult): ModelIdMap {
  return { [result.fragments.modelId]: new Set([result.localId]) };
}

async function raycastAtEvent(
  runtime: Runtime,
  event: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
) {
  // FragmentsManager.raycast expects raw client pixel coordinates, not
  // normalized device coordinates — it converts internally via the canvas's
  // getBoundingClientRect()/clientWidth (see RaycastManager.screenToCast in
  // @thatopen/fragments). Passing pre-normalized NDC here silently produces a
  // ray pointing nowhere near the cursor, with no error, just no hits.
  const mouse = new runtime.THREE.Vector2(event.clientX, event.clientY);

  return runtime.fragments.raycast({
    camera: runtime.world.camera.three,
    dom: canvas,
    mouse,
  });
}

async function clearHover(runtime: Runtime) {
  const { interaction } = runtime;
  if (!interaction.hoveredMap || interaction.hoveredKey === interaction.selectedKey) {
    interaction.hoveredKey = null;
    interaction.hoveredMap = null;
    return;
  }

  await runtime.fragments.resetHighlight(interaction.hoveredMap);
  interaction.hoveredKey = null;
  interaction.hoveredMap = null;
  runtime.fragments.core.update(true);
}

async function handleCanvasHover(
  runtime: Runtime,
  event: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
) {
  const { interaction } = runtime;
  if (interaction.hoverBusy) return;

  interaction.hoverBusy = true;
  try {
    const result = await raycastAtEvent(runtime, event, canvas);
    const key = result ? raycastKey(result) : null;

    if (key === interaction.hoveredKey) return;

    if (interaction.hoveredMap && interaction.hoveredKey !== interaction.selectedKey) {
      await runtime.fragments.resetHighlight(interaction.hoveredMap);
    }

    if (result && key !== interaction.selectedKey) {
      const map = raycastMap(result);
      await runtime.fragments.highlight(
        buildHighlightStyle(runtime, HOVER_COLOR),
        map,
      );
      interaction.hoveredKey = key;
      interaction.hoveredMap = map;
      canvas.style.cursor = "pointer";
    } else {
      interaction.hoveredKey = null;
      interaction.hoveredMap = null;
      canvas.style.cursor = "default";
    }

    runtime.fragments.core.update(true);
  } finally {
    interaction.hoverBusy = false;
  }
}

async function fetchSelectedElement(
  runtime: Runtime,
  result: RaycastResult,
): Promise<SelectedElement> {
  const modelId = result.fragments.modelId;
  const map: ModelIdMap = { [modelId]: new Set([result.localId]) };
  const dataByModel = await runtime.fragments.getData(map, {
    attributesDefault: true,
  });
  const data: ItemData = dataByModel[modelId]?.[0] ?? {};

  const nameAttribute = data.Name;
  const categoryAttribute = data._category;
  const name =
    nameAttribute && !Array.isArray(nameAttribute) && "value" in nameAttribute
      ? String(nameAttribute.value)
      : null;
  const category =
    categoryAttribute &&
    !Array.isArray(categoryAttribute) &&
    "value" in categoryAttribute
      ? String(categoryAttribute.value)
      : null;

  return { category, data, localId: result.localId, modelId, name };
}

async function handleCanvasSelect(
  runtime: Runtime,
  event: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
  onSelect: (element: SelectedElement | null) => void,
) {
  const { interaction } = runtime;
  const result = await raycastAtEvent(runtime, event, canvas);

  if (interaction.hoveredMap && interaction.hoveredKey !== interaction.selectedKey) {
    await runtime.fragments.resetHighlight(interaction.hoveredMap);
  }
  interaction.hoveredKey = null;
  interaction.hoveredMap = null;

  if (interaction.selectedMap) {
    await runtime.fragments.resetHighlight(interaction.selectedMap);
    interaction.selectedKey = null;
    interaction.selectedMap = null;
  }

  if (!result) {
    onSelect(null);
    runtime.fragments.core.update(true);
    return;
  }

  const key = raycastKey(result);
  const map = raycastMap(result);
  await runtime.fragments.highlight(buildHighlightStyle(runtime, SELECT_COLOR), map);
  interaction.selectedKey = key;
  interaction.selectedMap = map;
  runtime.fragments.core.update(true);

  const element = await fetchSelectedElement(runtime, result);
  onSelect(element);
}

async function clearSelectionHighlight(runtime: Runtime) {
  const { interaction } = runtime;
  if (interaction.selectedMap) {
    await runtime.fragments.resetHighlight(interaction.selectedMap);
    runtime.fragments.core.update(true);
  }
  interaction.selectedKey = null;
  interaction.selectedMap = null;
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
) {
  // No Authorization header: model files aren't confidential and the API
  // route doesn't check auth (see api/models/[modelId].ts), so omitting it
  // lets shared/CDN caches actually cache the response instead of treating
  // every request as unique to a caller.
  const response = await fetch(url);

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
  const pendingRouteViewRef = useRef<
    { mode: "2d"; id: string | null } | { mode: "3d" } | null
  >(null);
  const suppressNextRouteWriteRef = useRef(false);
  const canShowApplicationSettings = Boolean(applicationSettingsSlot);
  const [isReady, setIsReady] = useState(false);
  const [hasAppliedInitialRoute, setHasAppliedInitialRoute] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [activeSection, setActiveSection] =
    useState<DashboardSection>("home");
  const [modelStates, setModelStates] = useState(initialModelState);
  // loadModel only needs this to guard re-entrancy, not to react to changes,
  // and modelStates otherwise updates on every streamed byte — depending on
  // it directly would recreate loadModel/loadAll (and re-run the effects
  // that depend on them) on every progress tick.
  const modelStatesRef = useRef(modelStates);
  modelStatesRef.current = modelStates;
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] =
    useState<ProjectId>(DEFAULT_PROJECT_ID);
  const [loadRequestId, setLoadRequestId] = useState(0);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewCatalog, setViewCatalog] = useState<ViewCatalogEntry[]>([]);
  const [isProjecting2D, setIsProjecting2D] = useState(false);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const [cameraRouteVersion, setCameraRouteVersion] = useState(0);
  const [selectedElement, setSelectedElement] =
    useState<SelectedElement | null>(null);
  const [categoryTree, setCategoryTree] = useState<CategoryTreeEntry[]>([]);
  const [navigationMode, setNavigationModeState] =
    useState<NavigationMode>("Orbit");
  const [isSectionMode, setIsSectionMode] = useState(false);
  const [sectionCount, setSectionCount] = useState(0);
  const is2DView = activeViewId !== null;

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
  const showProjectSettingsPanel = isProjectSettingsOpen && canShowProjectSettings;
  const showElementInspectorPanel = !showProjectSettingsPanel && Boolean(selectedElement);

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
          view2dId: activeViewId,
          viewMode: is2DView ? "2d" : "3d",
        },
        updateMode,
      );
    },
    [
      activeModelId,
      activeProjectId,
      activeSection,
      activeViewId,
      currentModels,
      is2DView,
    ],
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
      pendingRouteViewRef.current =
        routeState.viewMode === "2d"
          ? { mode: "2d", id: routeState.view2dId }
          : { mode: "3d" };
      setActiveModelId(routeState.modelId);
      setActiveProjectId(routeState.projectId);
      setActiveSection(
        routeState.section === "application-settings" &&
          canShowApplicationSettings
          ? "application-settings"
          : routeState.section === "home"
            ? "home"
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
    activeViewId,
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
        const [OBC, THREE, FRAGS] = await Promise.all([
          import("@thatopen/components"),
          import("three"),
          import("@thatopen/fragments"),
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

        const fragments = components.get(OBC.FragmentsManager);
        // The self-hosted worker asset (see the top-of-file import) only
        // resolves correctly once bundled for production — in the Vite dev
        // server, requesting it as a live module worker fails silently and
        // every model load hangs. Fall back to the unpkg-hosted worker
        // (OBC.FragmentsManager's own default) for local development, where
        // that one extra fetch is a non-issue.
        const workerUrl = import.meta.env.DEV
          ? await OBC.FragmentsManager.getWorker()
          : fragmentsWorkerUrl;
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

        const views = components.get<Views>(OBC.Views);
        views.world = world;
        const clipper = components.get<Clipper>(OBC.Clipper);
        clipper.enabled = false;

        runtimeRef.current = {
          FRAGS,
          OBC,
          THREE,
          categoryTree: [],
          categoryTreeBuildKey: null,
          categoryTreeBuildPromise: null,
          categoryTreeModelsKey: null,
          clipper,
          components,
          drawings: new Map(),
          fragments,
          interaction: {
            hoverBusy: false,
            hoveredKey: null,
            hoveredMap: null,
            selectedKey: null,
            selectedMap: null,
          },
          viewCatalog: [],
          viewCatalogBuildKey: null,
          viewCatalogBuildPromise: null,
          viewCatalogModelsKey: null,
          views,
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

  const resetViews = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    resetViewCatalog(runtime);
    setViewCatalog([]);
  }, []);

  const clearSelection = useCallback(() => {
    const runtime = runtimeRef.current;
    setSelectedElement(null);
    if (!runtime) return;
    void clearSelectionHighlight(runtime);
  }, []);

  const setNavigationMode = useCallback((mode: NavigationMode) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    runtime.world.camera.set(mode);
    setNavigationModeState(mode);
  }, []);

  const toggleSectionMode = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    const next = !runtime.clipper.enabled;
    runtime.clipper.enabled = next;
    setIsSectionMode(next);
  }, []);

  const clearSections = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    runtime.clipper.deleteAll();
    setSectionCount(0);
  }, []);

  const ensureViewCatalog = useCallback(
    async (runtime: Runtime) => {
      const loadedModelIds = getLoadedModelIds(runtime, currentModels);
      const modelsKey = loadedModelIds.join("|");
      if (runtime.viewCatalogModelsKey === modelsKey) {
        return runtime.viewCatalog;
      }

      // buildViewCatalog clears and recreates every OBC.Views entry, so two
      // overlapping builds (e.g. React StrictMode's double effect run, or two
      // models finishing loading in quick succession) would race and corrupt
      // each other's output. Share one in-flight build per models signature.
      if (
        runtime.viewCatalogBuildPromise &&
        runtime.viewCatalogBuildKey === modelsKey
      ) {
        return runtime.viewCatalogBuildPromise;
      }

      const buildPromise = buildViewCatalog(runtime, currentModels).then(
        (catalog) => {
          if (runtime.viewCatalogBuildPromise === buildPromise) {
            runtime.viewCatalogBuildPromise = null;
            runtime.viewCatalogBuildKey = null;
          }
          setViewCatalog(catalog);
          return catalog;
        },
      );
      runtime.viewCatalogBuildPromise = buildPromise;
      runtime.viewCatalogBuildKey = modelsKey;
      return buildPromise;
    },
    [currentModels],
  );

  const resetCategoryTreeState = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    resetCategoryTree(runtime);
    setCategoryTree([]);
  }, []);

  const ensureCategoryTree = useCallback(
    async (runtime: Runtime) => {
      const loadedModelIds = getLoadedModelIds(runtime, currentModels);
      const modelsKey = loadedModelIds.join("|");
      if (runtime.categoryTreeModelsKey === modelsKey) {
        return runtime.categoryTree;
      }

      if (
        runtime.categoryTreeBuildPromise &&
        runtime.categoryTreeBuildKey === modelsKey
      ) {
        return runtime.categoryTreeBuildPromise;
      }

      const buildPromise = buildCategoryTree(runtime, currentModels).then(
        (tree) => {
          if (runtime.categoryTreeBuildPromise === buildPromise) {
            runtime.categoryTreeBuildPromise = null;
            runtime.categoryTreeBuildKey = null;
          }
          runtime.categoryTree = tree;
          runtime.categoryTreeModelsKey = modelsKey;
          setCategoryTree(tree);
          return tree;
        },
      );
      runtime.categoryTreeBuildPromise = buildPromise;
      runtime.categoryTreeBuildKey = modelsKey;
      return buildPromise;
    },
    [currentModels],
  );

  const toggleCategory = useCallback(async (category: string) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    const entry = runtime.categoryTree.find((item) => item.category === category);
    if (!entry) return;

    const nextVisible = !entry.visible;
    if (nextVisible) {
      await runtime.fragments.resetHighlight(entry.map);
    } else {
      await runtime.fragments.highlight(buildHiddenStyle(runtime), entry.map);
    }
    runtime.categoryTree = runtime.categoryTree.map((item) =>
      item.category === category ? { ...item, visible: nextVisible } : item,
    );
    setCategoryTree(runtime.categoryTree);
    runtime.fragments.core.update(true);
  }, []);

  const isolateCategory = useCallback(async (category: string) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    const hiddenStyle = buildHiddenStyle(runtime);
    for (const item of runtime.categoryTree) {
      if (item.category === category) {
        await runtime.fragments.resetHighlight(item.map);
      } else {
        await runtime.fragments.highlight(hiddenStyle, item.map);
      }
    }
    runtime.categoryTree = runtime.categoryTree.map((item) => ({
      ...item,
      visible: item.category === category,
    }));
    setCategoryTree(runtime.categoryTree);
    runtime.fragments.core.update(true);
  }, []);

  const showAllCategories = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    for (const item of runtime.categoryTree) {
      if (!item.visible) {
        await runtime.fragments.resetHighlight(item.map);
      }
    }
    runtime.categoryTree = runtime.categoryTree.map((item) => ({
      ...item,
      visible: true,
    }));
    setCategoryTree(runtime.categoryTree);
    runtime.fragments.core.update(true);
  }, []);

  const selectView = useCallback(
    async (
      nextViewId: string | null,
      historyUpdateMode?: HistoryUpdateMode,
    ) => {
      const runtime = runtimeRef.current;
      if (!runtime || isProjecting2D) return;

      if (historyUpdateMode) {
        routeWriteModeRef.current = historyUpdateMode;
      }

      setProjectionError(null);

      if (nextViewId === null) {
        setProjectModelsVisible(runtime, currentModels, true);
        for (const drawing of runtime.drawings.values()) {
          drawing.three.visible = false;
        }

        runtime.world.camera.set("Orbit");
        setNavigationModeState("Orbit");
        await runtime.world.camera.projection.set("Perspective");
        await runtime.world.camera.controls.setLookAt(
          ...DEFAULT_CAMERA_VIEW.position,
          ...DEFAULT_CAMERA_VIEW.target,
          true,
        );
        runtime.fragments.core.update(true);
        setActiveViewId(null);
        return;
      }

      setIsProjecting2D(true);
      clearSelection();

      try {
        const loadedModelIds = getLoadedModelIds(runtime, currentModels);
        if (!loadedModelIds.length) {
          throw new Error("Load a model before switching to 2D.");
        }

        await ensureViewCatalog(runtime);
        const view = runtime.views.list.get(nextViewId);
        if (!view) {
          throw new Error("That view is no longer available.");
        }

        const bounds = getProjectModelBounds(runtime, currentModels);
        const center = bounds?.getCenter(new runtime.THREE.Vector3());
        const size = bounds?.getSize(new runtime.THREE.Vector3());
        const viewSize = size ? Math.max(size.x, size.y, size.z, 24) : 40;

        setProjectModelsVisible(runtime, currentModels, true);
        for (const drawing of runtime.drawings.values()) {
          drawing.three.visible = false;
        }

        await runtime.world.camera.projection.set("Orthographic");
        runtime.world.camera.set("Plan");

        const target = center
          ? view.plane.projectPoint(center, new runtime.THREE.Vector3())
          : view.plane.normal.clone().multiplyScalar(-view.plane.constant);
        const eye = target
          .clone()
          .addScaledVector(
            view.plane.normal.clone().negate(),
            viewSize * 1.75,
          );
        await runtime.world.camera.controls.setLookAt(
          eye.x,
          eye.y,
          eye.z,
          target.x,
          target.y,
          target.z,
          true,
        );

        const meshes = collectProjectMeshes(runtime, currentModels);
        if (meshes.length) {
          await runtime.world.camera.fit(meshes, 1.25);
        }

        const drawing = await ensureDrawingForView(
          runtime,
          currentModels,
          view,
        );
        setProjectModelsVisible(runtime, currentModels, false);
        drawing.three.visible = true;
        runtime.fragments.core.update(true);
        setActiveViewId(nextViewId);
      } catch (error) {
        setProjectModelsVisible(runtime, currentModels, true);
        for (const drawing of runtime.drawings.values()) {
          drawing.three.visible = false;
        }
        runtime.world.camera.set("Orbit");
        setNavigationModeState("Orbit");
        await runtime.world.camera.projection.set("Perspective");
        await runtime.world.camera.controls.setLookAt(
          ...DEFAULT_CAMERA_VIEW.position,
          ...DEFAULT_CAMERA_VIEW.target,
          true,
        );
        setProjectionError(
          error instanceof Error
            ? error.message
            : "That 2D view could not be generated.",
        );
        setActiveViewId(null);
      } finally {
        setIsProjecting2D(false);
      }
    },
    [clearSelection, currentModels, ensureViewCatalog, isProjecting2D],
  );

  const loadModel = useCallback(
    async (model: DemoModel) => {
      const runtime = runtimeRef.current;
      if (!runtime || modelStatesRef.current[model.id].status === "streaming") {
        return;
      }
      resetViews();
      setActiveViewId(null);
      setProjectionError(null);
      clearSelection();
      resetCategoryTreeState();

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
        );
        const streamedBytes = buffer.byteLength;

        // fragments.list.onItemSet (wired in initViewer) already calls
        // core.update(true) as soon as this model is added to the list,
        // which core.load() guarantees has happened by the time it resolves
        // — an extra call here would just repeat that same flush.
        await runtime.fragments.core.load(buffer, { modelId: model.id });
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
    [clearSelection, resetCategoryTreeState, resetViews, setModelState],
  );

  const unloadAllModels = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (runtime) {
      resetViews();
      setActiveViewId(null);
      setProjectionError(null);
      clearSelection();
      resetCategoryTreeState();

      for (const model of MODELS) {
        if (runtime.fragments.list.has(model.id)) {
          await runtime.fragments.core.disposeModel(model.id);
        }
      }
      runtime.fragments.core.update(true);
    }

    setActiveModelId(null);
    setModelStates(initialModelState());
  }, [clearSelection, resetCategoryTreeState, resetViews]);

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

  const goHome = () => {
    if (activeSection === "home") return;

    routeWriteModeRef.current = "push";
    if (isProjectSettingsOpen) {
      onProjectSettingsToggle?.();
    }
    setActiveSection("home");
  };

  const loadAll = useCallback(async () => {
    const preferredModelId = getRouteModelId(activeModelId, activeProjectId);

    // Each model's own fetch+parse is independent, so load a project's
    // disciplines (e.g. architecture + structure) concurrently instead of
    // making the smaller one wait on the larger one to finish first.
    await Promise.all(
      currentModels
        .filter(
          (model) => model.url && modelStates[model.id].status !== "loaded",
        )
        .map((model) => loadModel(model)),
    );

    if (
      preferredModelId &&
      currentModels.some((model) => model.id === preferredModelId)
    ) {
      setActiveModelId(preferredModelId);
    }

    // The initial camera position is tuned for one specific model, so it
    // doesn't generalize across projects of very different scale/origin —
    // fit to the loaded geometry instead, unless a shared link is about to
    // restore its own saved camera.
    const runtime = runtimeRef.current;
    if (runtime && !pendingRouteCameraRef.current) {
      const meshes = collectProjectMeshes(runtime, currentModels);
      if (meshes.length) {
        await runtime.world.camera.fit(meshes, 1.25);
      }
    }
  }, [activeModelId, activeProjectId, currentModels, loadModel, modelStates]);

  useEffect(() => {
    // Don't eagerly stream a project's models before the user has actually
    // chosen to view one — landing on the home page shouldn't kick off
    // multi-MB downloads for whatever project happens to be "default".
    if (!isReady || activeSection !== "viewer") {
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
    activeSection,
    currentModels,
    isReady,
    loadAll,
    loadRequestId,
    modelStates,
  ]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !isReady) return;

    const loadedModelIds = getLoadedModelIds(runtime, currentModels);
    if (!loadedModelIds.length) {
      if (runtime.viewCatalog.length) {
        resetViews();
      }
      return;
    }

    if (runtime.viewCatalogModelsKey === loadedModelIds.join("|")) return;

    const timeoutId = window.setTimeout(() => {
      void ensureViewCatalog(runtime);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [activeCount, currentModels, ensureViewCatalog, isReady, resetViews]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !isReady) return;

    const loadedModelIds = getLoadedModelIds(runtime, currentModels);
    if (!loadedModelIds.length) {
      if (runtime.categoryTree.length) {
        resetCategoryTreeState();
      }
      return;
    }

    if (runtime.categoryTreeModelsKey === loadedModelIds.join("|")) return;

    const timeoutId = window.setTimeout(() => {
      void ensureCategoryTree(runtime);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeCount,
    currentModels,
    ensureCategoryTree,
    isReady,
    resetCategoryTreeState,
  ]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !isReady || is2DView || isSectionMode) return;

    const canvas = runtime.world.renderer.three.domElement;

    const onPointerMove = (event: PointerEvent) => {
      void handleCanvasHover(runtime, event, canvas);
    };
    const onPointerLeave = () => {
      void clearHover(runtime);
      canvas.style.cursor = "default";
    };
    const onClick = (event: MouseEvent) => {
      void handleCanvasSelect(runtime, event, canvas, setSelectedElement);
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("click", onClick);

    return () => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      canvas.style.cursor = "default";
      void clearHover(runtime);
    };
  }, [is2DView, isReady, isSectionMode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !isReady || is2DView || !isSectionMode) return;

    const canvas = runtime.world.renderer.three.domElement;
    const { clipper } = runtime;

    const updateCount = () => setSectionCount(clipper.list.size);
    const onDoubleClick = () => {
      void clipper.create(runtime.world).then(() => {
        runtime.fragments.core.update(true);
        updateCount();
      });
    };

    clipper.onAfterCreate.add(updateCount);
    clipper.onAfterDelete.add(updateCount);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.style.cursor = "crosshair";

    return () => {
      clipper.onAfterCreate.remove(updateCount);
      clipper.onAfterDelete.remove(updateCount);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.style.cursor = "default";
    };
  }, [is2DView, isReady, isSectionMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const routeState = parseRouteState();
      suppressNextRouteWriteRef.current = true;
      pendingRouteCameraRef.current = routeState.camera;
      pendingRouteViewRef.current =
        routeState.viewMode === "2d"
          ? { mode: "2d", id: routeState.view2dId }
          : { mode: "3d" };
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
            : routeState.section === "home"
              ? "home"
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
    const pending = pendingRouteViewRef.current;
    if (!pending || !isReady || isProjecting2D) return;

    if (pending.mode === "3d") {
      pendingRouteViewRef.current = null;
      if (is2DView) {
        const timeoutId = window.setTimeout(() => {
          void selectView(null);
        }, 0);
        return () => window.clearTimeout(timeoutId);
      }
      return;
    }

    if (is2DView && (pending.id === null || activeViewId === pending.id)) {
      pendingRouteViewRef.current = null;
      return;
    }

    if (!canToggle2D) return;
    if (!viewCatalog.length) return;

    const requestedId =
      pending.id && viewCatalog.some((entry) => entry.id === pending.id)
        ? pending.id
        : viewCatalog[0].id;

    pendingRouteViewRef.current = null;
    const timeoutId = window.setTimeout(() => {
      void selectView(requestedId);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [
    activeViewId,
    canToggle2D,
    is2DView,
    isProjecting2D,
    isReady,
    selectView,
    viewCatalog,
  ]);

  useEffect(() => {
    const camera = pendingRouteCameraRef.current;
    if (!camera || !isReady) return;
    if (pendingRouteViewRef.current?.mode === "2d" && !is2DView) return;

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
          <button
            aria-pressed={activeSection === "home"}
            className="project-button"
            onClick={goHome}
            type="button"
          >
            <Home className="icon" aria-hidden="true" />
            <span>
              <strong>Home</strong>
              <small>All projects</small>
            </span>
          </button>

          {activeSection !== "home" ? (
            <label className="project-switcher">
              <span>Current project</span>
              <select
                aria-label="Switch project"
                onChange={(event) =>
                  void switchProject(event.target.value as ProjectId)
                }
                value={activeProjectId}
              >
                {resolvedProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
          <div className="sidebar-git-info" title="Current build branch and commit">
            <GitBranch className="icon" aria-hidden="true" />
            <span>
              <strong>{process.env.NEXT_PUBLIC_GIT_BRANCH || "main"}</strong>
              <small>{process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || "dev"}</small>
            </span>
          </div>
        </div>
      </aside>

      <section
        className="dashboard-main"
        id="dashboard-main"
        aria-label="BIM dashboard"
      >
        <section
          aria-hidden={activeSection !== "viewer"}
          className={`project-grid${showProjectSettingsPanel || showElementInspectorPanel ? " has-settings" : ""}${categoryTree.length ? " has-tree" : ""}${activeSection === "viewer" ? "" : " is-background"}`}
        >
          {categoryTree.length ? (
            <CategoryTree
              entries={categoryTree}
              onIsolate={(category) => void isolateCategory(category)}
              onShowAll={() => void showAllCategories()}
              onToggle={(category) => void toggleCategory(category)}
            />
          ) : null}

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
                <label
                  className={`view-mode-picker${is2DView ? " is-2d" : ""}`}
                  title={is2DView ? "2D view" : "3D view"}
                >
                  {isProjecting2D ? (
                    <LoaderCircle className="icon spin" aria-hidden="true" />
                  ) : is2DView ? (
                    <SquareStack className="icon" aria-hidden="true" />
                  ) : (
                    <Box className="icon" aria-hidden="true" />
                  )}
                  <select
                    aria-label="Viewport mode"
                    className="view-mode-select"
                    disabled={!canToggle2D || isProjecting2D}
                    onChange={(event) =>
                      void selectView(
                        event.target.value === "3d" ? null : event.target.value,
                        "push",
                      )
                    }
                    value={activeViewId ?? "3d"}
                  >
                    <option value="3d">3D</option>
                    {viewCatalog.length > 0 ? (
                      <>
                        <optgroup label="Floor Plans">
                          {viewCatalog
                            .filter((entry) => entry.group === "Floor Plans")
                            .map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.label}
                              </option>
                            ))}
                        </optgroup>
                        <optgroup label="Elevations">
                          {viewCatalog
                            .filter((entry) => entry.group === "Elevations")
                            .map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.label}
                              </option>
                            ))}
                        </optgroup>
                      </>
                    ) : null}
                  </select>
                </label>
                {!is2DView ? (
                  <button
                    aria-label={
                      navigationMode === "FirstPerson"
                        ? "Switch to orbit navigation"
                        : "Switch to first-person navigation"
                    }
                    aria-pressed={navigationMode === "FirstPerson"}
                    className="nav-mode-toggle"
                    disabled={!isReady}
                    onClick={() =>
                      setNavigationMode(
                        navigationMode === "FirstPerson" ? "Orbit" : "FirstPerson",
                      )
                    }
                    title={
                      navigationMode === "FirstPerson"
                        ? "First-person"
                        : "Orbit"
                    }
                    type="button"
                  >
                    {navigationMode === "FirstPerson" ? (
                      <Footprints className="icon" aria-hidden="true" />
                    ) : (
                      <Orbit className="icon" aria-hidden="true" />
                    )}
                  </button>
                ) : null}
                {!is2DView ? (
                  <button
                    aria-label={
                      isSectionMode
                        ? "Stop adding section planes"
                        : "Add section plane (double-click the model)"
                    }
                    aria-pressed={isSectionMode}
                    className="nav-mode-toggle"
                    disabled={!isReady}
                    onClick={toggleSectionMode}
                    title="Section"
                    type="button"
                  >
                    <Scissors className="icon" aria-hidden="true" />
                  </button>
                ) : null}
                {!is2DView && sectionCount > 0 ? (
                  <button
                    aria-label="Clear all section planes"
                    className="clear-sections-button"
                    onClick={clearSections}
                    title="Clear sections"
                    type="button"
                  >
                    Clear sections ({sectionCount})
                  </button>
                ) : null}
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

          {showProjectSettingsPanel &&
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

          {showElementInspectorPanel && selectedElement ? (
            <section className="settings-panel" aria-label="Element properties">
              <ElementInspector
                element={selectedElement}
                onClose={clearSelection}
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

        {activeSection === "home" ? (
          <section className="project-home" aria-label="Projects">
            <header className="project-home-header">
              <h1>{APP_NAME}</h1>
              <p>Select a project to open its BIM viewer.</p>
            </header>
            <div className="project-home-grid">
              {resolvedProjects.map((project) => (
                <button
                  className="project-card"
                  key={project.id}
                  onClick={() => void switchProject(project.id)}
                  type="button"
                >
                  {project.id === "demo" ? (
                    <Layers3 className="icon-lg" aria-hidden="true" />
                  ) : (
                    <Building2 className="icon-lg" aria-hidden="true" />
                  )}
                  <strong>{project.label}</strong>
                  {project.description ? <p>{project.description}</p> : null}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
