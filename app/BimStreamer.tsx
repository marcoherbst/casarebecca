"use client";

import {
  Box,
  Building2,
  Eye,
  EyeOff,
  Focus,
  Footprints,
  GitBranch,
  Home,
  LandPlot,
  Layers3,
  ListTree,
  LoaderCircle,
  Orbit,
  RotateCcw,
  Ruler,
  Scan,
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
import type { AreaMeasurement, LengthMeasurement } from "@thatopen/components-front";
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
type ActiveTool = "none" | "section" | "length" | "area";
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
  area: AreaMeasurement;
  clipper: Clipper;
  components: { dispose: () => void; get: <T>(component: unknown) => T };
  drawings: Map<string, TechnicalDrawing>;
  fragments: FragmentsManager;
  hiddenKeys: Set<string>;
  interaction: InteractionState;
  length: LengthMeasurement;
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
 * Real-world IFC/Revit models routinely define more storeys than a building
 * actually has floors at — most often leftover default levels a Revit
 * project template ships with (e.g. "Level 3"/"Level 4") that the architect
 * never deleted after adding their own named levels, plus the odd site
 * benchmark ("Sea Level"). `createFromIfcStoreys` has no way to know the
 * difference; it turns every `IfcBuildingStorey` into a floor plan candidate
 * regardless. `FragmentsModel.getSpatialStructure()` would be the correct
 * signal (real IFC spatial containment), but it comes back essentially
 * empty for at least one real converted model this app serves — so this
 * instead checks, per candidate elevation, whether any actual geometry sits
 * close to it. A real floor/roof level has a slab or structure right at its
 * elevation; an orphaned reference level sitting a fraction of a metre away
 * from the real level it shadows does not.
 *
 * Uses `FragmentsManager.getBBoxes()` (metadata-derived, per item) rather
 * than walking the loaded THREE.Mesh tiles: a complex model's tiles stream
 * into the scene progressively, so at the point the view catalog is built
 * the visual geometry may not have arrived yet even though the model is
 * fully loaded and its item data already queryable.
 */
async function getElevationsWithContent(
  runtime: Runtime,
  models: DemoModel[],
  elevations: number[],
  tolerance = 0.3,
): Promise<Set<number>> {
  const itemMap = await getProjectModelIdMap(runtime, models);
  const rawBoxes = await runtime.fragments.getBBoxes(itemMap);

  // A handful of items in real-world exports carry a degenerate/placeholder
  // bounding box (a site boundary, a project-wide proxy) spanning far more
  // than any real building element — worse, spanning enough of the Y axis
  // that every candidate elevation reads as "inside" it, defeating this
  // check entirely. Exclude anything absurdly tall compared to the *typical*
  // item in this model — self-calibrating per model, unlike a fixed number
  // or (the bug this replaced) a threshold derived from the candidate
  // elevations themselves, which is circular when one of those candidates
  // (e.g. a distant site datum) is itself the outlier inflating the spread.
  const heights = rawBoxes
    .map((box) => box.max.y - box.min.y)
    .sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 1;
  const maxReasonableHeight = Math.max(medianHeight * 20, 5);
  const boxes = rawBoxes.filter(
    (box) => box.max.y - box.min.y <= maxReasonableHeight,
  );
  console.log(
    "[storeys] medianHeight",
    medianHeight,
    "maxReasonableHeight",
    maxReasonableHeight,
    "rawBoxes",
    rawBoxes.length,
    "keptBoxes",
    boxes.length,
  );

  const withContent = new Set<number>();
  for (const elevation of elevations) {
    const hasNearbyGeometry = boxes.some(
      (box) =>
        box.min.y <= elevation + tolerance && box.max.y >= elevation - tolerance,
    );
    console.log("[storeys] elevation", elevation, "hasContent", hasNearbyGeometry);
    if (hasNearbyGeometry) withContent.add(elevation);
  }

  return withContent;
}

/**
 * Generates the app's standard set of `OBC.Views` — cut planes with a name,
 * normal, and height range (one per IFC building storey, falling back to a
 * single overall plan when storey metadata isn't available, e.g. the bundled
 * demo models, plus front/back/left/right elevations of the combined model
 * bounds). A `View` is just that plane definition; it has no visual
 * representation of its own until `ensureDrawingForView` projects the model
 * onto it to produce an actual `TechnicalDrawing`.
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

  // Drop storeys that are pure reference datums (a leftover default Revit
  // level, a site benchmark) with no geometry actually sitting at their
  // elevation — real for the model, but not a meaningful floor plan. Falls
  // back to the unfiltered set if the check finds nothing with content at
  // all (e.g. models still mid-load) rather than showing zero floor plans.
  const elevationsWithContent = await getElevationsWithContent(
    runtime,
    models,
    [...uniqueStoreyViews.values()].map((view) => view.plane.constant),
  );
  const contentfulStoreyViews = [...uniqueStoreyViews.values()].filter(
    (view) => elevationsWithContent.has(view.plane.constant),
  );
  if (contentfulStoreyViews.length) {
    for (const view of uniqueStoreyViews.values()) {
      if (!elevationsWithContent.has(view.plane.constant)) view.dispose();
    }
  } else {
    contentfulStoreyViews.push(...uniqueStoreyViews.values());
  }

  if (contentfulStoreyViews.length) {
    const sorted = contentfulStoreyViews.sort(
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

/**
 * Frames the camera on an arbitrary Object3D's own bounding sphere.
 *
 * `OrthoPerspectiveCamera.fit()` always folds in every loaded Fragments
 * model's bounds on top of whatever meshes you pass it (it's built for the
 * "orbit the 3D scene" case), so it can't be used to frame a `TechnicalDrawing`
 * in isolation — the hidden 3D models it was projected from would still
 * dominate the framing. This replicates fit()'s underlying mechanism
 * (bounding sphere + `controls.fitToSphere`) against just the given object.
 *
 * Deliberately does NOT reuse fit()'s own `maxDim * offset` radius formula:
 * that treats the single longest axis as the sphere's radius, which is a
 * reasonable-looking overestimate for a roughly cube-shaped 3D building but
 * leaves a lot of dead space around a flat, elongated shape like a floor
 * plan or elevation drawing (aspect ratios of 2:1 or more are typical).
 * Using the box's actual diagonal gives a sphere that's a tight fit
 * regardless of aspect ratio.
 */
async function fitCameraToObject(
  runtime: Runtime,
  object: THREE.Object3D,
  offset = 1.1,
) {
  await fitCameraToBox(
    runtime,
    new runtime.THREE.Box3().setFromObject(object),
    offset,
  );
}

/** Shared core behind {@link fitCameraToObject} — see its docstring above. */
async function fitCameraToBox(runtime: Runtime, box: THREE.Box3, offset = 1.1) {
  if (box.isEmpty()) return;

  const size = box.getSize(new runtime.THREE.Vector3());
  const center = box.getCenter(new runtime.THREE.Vector3());
  const radius = (size.length() / 2) * offset;
  await runtime.world.camera.controls.fitToSphere(
    new runtime.THREE.Sphere(center, radius),
    true,
  );
}

/**
 * Builds (and caches) the `TechnicalDrawing` for a given `View` — the actual
 * vector line-art produced by projecting the loaded models onto that view's
 * plane. This is a distinct rendering technology from `OBC.Views` itself:
 * the view only supplies the cut plane and range used for the projection.
 */
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

/**
 * Translucent "ghost" style for X-ray mode — same mechanism as
 * {@link buildHiddenStyle}, but partially visible instead of fully invisible,
 * so the whole building reads as a see-through shell.
 */
function buildGhostStyle(runtime: Runtime) {
  return {
    color: new runtime.THREE.Color("#8a8f98"),
    opacity: 0.18,
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

function keysFromModelIdMap(map: ModelIdMap): string[] {
  const keys: string[] = [];
  for (const [modelId, ids] of Object.entries(map)) {
    for (const id of ids) keys.push(`${modelId}:${id}`);
  }
  return keys;
}

function markHidden(runtime: Runtime, map: ModelIdMap) {
  for (const key of keysFromModelIdMap(map)) runtime.hiddenKeys.add(key);
}

/**
 * Hides every currently-loaded item except `keepMap` — the shared primitive
 * behind both the category tree's per-category "Isolate" button and the
 * toolbar's "Isolate selected" action. Marks the hidden items in
 * `runtime.hiddenKeys` so a later hover/select doesn't re-highlight (and so
 * visually un-hide) them — see {@link handleCanvasHover}/{@link handleCanvasSelect}.
 */
async function isolateModelIdMap(
  runtime: Runtime,
  models: DemoModel[],
  keepMap: ModelIdMap,
) {
  const allMap = await getProjectModelIdMap(runtime, models);
  const toHide: ModelIdMap = {};
  for (const [modelId, ids] of Object.entries(allMap)) {
    const keepIds = keepMap[modelId];
    const remaining = keepIds ? [...ids].filter((id) => !keepIds.has(id)) : [...ids];
    if (remaining.length) toHide[modelId] = new Set(remaining);
  }

  await runtime.fragments.highlight(buildHiddenStyle(runtime), toHide);
  await runtime.fragments.resetHighlight(keepMap);
  markHidden(runtime, toHide);
  runtime.fragments.core.update(true);
}

/** Fits the camera to the bounding box of an arbitrary selection map. */
async function focusOnMap(runtime: Runtime, map: ModelIdMap) {
  const boxes = await runtime.fragments.getBBoxes(map);
  if (!boxes.length) return;
  const box = boxes.reduce((acc, next) => acc.union(next), boxes[0].clone());
  // A single small item needs more breathing room than the whole-model fit's
  // default offset, or it fills the frame edge-to-edge with no context.
  await fitCameraToBox(runtime, box, 1.6);
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
    let result = await raycastAtEvent(runtime, event, canvas);
    if (result && runtime.hiddenKeys.has(raycastKey(result))) {
      // Hidden geometry stays raycastable (buildHiddenStyle only sets
      // opacity: 0), so without this it would visually un-hide itself the
      // moment the cursor passes over it.
      result = undefined;
    }
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
  let result = await raycastAtEvent(runtime, event, canvas);
  if (result && runtime.hiddenKeys.has(raycastKey(result))) {
    result = undefined;
  }

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
  const [activeTool, setActiveTool] = useState<ActiveTool>("none");
  const [sectionCount, setSectionCount] = useState(0);
  const [isXrayMode, setIsXrayMode] = useState(false);
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
  const displayedStreamStatus = isProjecting2D
    ? "Generating drawing"
    : streamStatus;
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
        const [OBC, THREE, FRAGS, OBF] = await Promise.all([
          import("@thatopen/components"),
          import("three"),
          import("@thatopen/fragments"),
          import("@thatopen/components-front"),
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
        // RendererWith2D (not the plain SimpleRenderer) — a drop-in subclass
        // that additionally composites a CSS2DRenderer overlay, which the
        // length/area measurement tools below need to render their dimension
        // value labels.
        world.renderer = new OBF.RendererWith2D(components, viewerRef.current, {
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

        const length = components.get<LengthMeasurement>(OBF.LengthMeasurement);
        length.world = world;
        length.enabled = false;
        const area = components.get<AreaMeasurement>(OBF.AreaMeasurement);
        area.world = world;
        area.enabled = false;

        runtimeRef.current = {
          FRAGS,
          OBC,
          THREE,
          area,
          categoryTree: [],
          categoryTreeBuildKey: null,
          categoryTreeBuildPromise: null,
          categoryTreeModelsKey: null,
          clipper,
          components,
          drawings: new Map(),
          fragments,
          hiddenKeys: new Set(),
          interaction: {
            hoverBusy: false,
            hoveredKey: null,
            hoveredMap: null,
            selectedKey: null,
            selectedMap: null,
          },
          length,
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

  // Section/length/area are mutually exclusive canvas interaction modes —
  // switching to one disables the others' pointer handling and Createable
  // instance in one place, rather than juggling independent booleans.
  const setActiveToolMode = useCallback((tool: ActiveTool) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    runtime.clipper.enabled = tool === "section";
    runtime.length.enabled = tool === "length";
    runtime.area.enabled = tool === "area";
    setActiveTool(tool);
  }, []);

  const toggleSectionMode = useCallback(() => {
    setActiveToolMode(activeTool === "section" ? "none" : "section");
  }, [activeTool, setActiveToolMode]);

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

  const focusOnSelection = useCallback(() => {
    const runtime = runtimeRef.current;
    const map = runtime?.interaction.selectedMap;
    if (!runtime || !map) return;
    void focusOnMap(runtime, map);
  }, []);

  const hideSelected = useCallback(() => {
    const runtime = runtimeRef.current;
    const map = runtime?.interaction.selectedMap;
    if (!runtime || !map) return;
    void (async () => {
      await runtime.fragments.highlight(buildHiddenStyle(runtime), map);
      markHidden(runtime, map);
      runtime.fragments.core.update(true);
      clearSelection();
    })();
  }, [clearSelection]);

  const isolateSelected = useCallback(() => {
    const runtime = runtimeRef.current;
    const map = runtime?.interaction.selectedMap;
    if (!runtime || !map) return;
    void isolateModelIdMap(runtime, currentModels, map);
  }, [currentModels]);

  const toggleXray = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    void (async () => {
      const allMap = await getProjectModelIdMap(runtime, currentModels);
      if (isXrayMode) {
        await runtime.fragments.resetHighlight(allMap);
      } else {
        await runtime.fragments.highlight(buildGhostStyle(runtime), allMap);
      }
      runtime.fragments.core.update(true);
      setIsXrayMode(!isXrayMode);
    })();
  }, [currentModels, isXrayMode]);

  // A deliberate full reset rather than tracking + reconciling per-item
  // hide/isolate/x-ray state against the category tree's own per-category
  // visibility — see isolateModelIdMap's docstring for why that would be a
  // second source of truth to keep in sync.
  const resetView = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    clearSelection();
    void showAllCategories();
    void (async () => {
      const allMap = await getProjectModelIdMap(runtime, currentModels);
      await runtime.fragments.resetHighlight(allMap);
      runtime.hiddenKeys.clear();
      runtime.fragments.core.update(true);
    })();

    setIsXrayMode(false);
    setActiveToolMode("none");
    setNavigationMode("Orbit");

    const bounds = getProjectModelBounds(runtime, currentModels);
    if (bounds) void fitCameraToBox(runtime, bounds, 1.25);
  }, [
    clearSelection,
    currentModels,
    setActiveToolMode,
    setNavigationMode,
    showAllCategories,
  ]);

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

        // Rough initial framing from the source model's bounds, so the
        // camera lands somewhere sane while the drawing is still building.
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

        // camera.fit() above always folds the hidden 3D models' bounds back
        // in (see fitCameraToObject's docstring), so it can't frame the
        // drawing on its own — do a final fit against just the drawing.
        await fitCameraToObject(runtime, drawing.three);
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
            : "That technical drawing could not be generated.",
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
    if (!runtime || !isReady || is2DView || activeTool !== "none") return;

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
  }, [activeTool, is2DView, isReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !isReady || is2DView || activeTool !== "section") return;

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
  }, [activeTool, is2DView, isReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (
      !runtime ||
      !isReady ||
      is2DView ||
      (activeTool !== "length" && activeTool !== "area")
    ) {
      return;
    }

    const instance = activeTool === "length" ? runtime.length : runtime.area;
    const canvas = runtime.world.renderer.three.domElement;

    const onClick = () => {
      void instance.create();
    };
    // Length auto-completes once two points are placed, but Area (a
    // variable-length polygon) needs an explicit "finish" signal — same
    // double-click-to-commit convention as the Clipper section-plane tool.
    const onDoubleClick = () => {
      instance.endCreation();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        instance.delete();
      } else if (event.key === "Enter") {
        instance.endCreation();
      }
    };

    canvas.addEventListener("click", onClick);
    canvas.addEventListener("dblclick", onDoubleClick);
    window.addEventListener("keydown", onKeydown);
    canvas.style.cursor = "crosshair";

    return () => {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("dblclick", onDoubleClick);
      window.removeEventListener("keydown", onKeydown);
      canvas.style.cursor = "default";
    };
  }, [activeTool, is2DView, isReady]);

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
                  title={is2DView ? "Technical drawing" : "3D model"}
                >
                  {isProjecting2D ? (
                    <LoaderCircle className="icon spin" aria-hidden="true" />
                  ) : is2DView ? (
                    <SquareStack className="icon" aria-hidden="true" />
                  ) : (
                    <Box className="icon" aria-hidden="true" />
                  )}
                  <select
                    aria-label="3D model or technical drawing"
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
                      activeTool === "section"
                        ? "Stop adding section planes"
                        : "Add section plane (double-click the model)"
                    }
                    aria-pressed={activeTool === "section"}
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
                {!is2DView ? (
                  <>
                    <span aria-hidden="true" className="toolbar-divider" />
                    <button
                      aria-label="Focus on selection"
                      className="nav-mode-toggle"
                      disabled={!isReady || !selectedElement}
                      onClick={focusOnSelection}
                      title="Focus"
                      type="button"
                    >
                      <Focus className="icon" aria-hidden="true" />
                    </button>
                    <button
                      aria-label="Hide selected"
                      className="nav-mode-toggle"
                      disabled={!isReady || !selectedElement}
                      onClick={hideSelected}
                      title="Hide selected"
                      type="button"
                    >
                      <EyeOff className="icon" aria-hidden="true" />
                    </button>
                    <button
                      aria-label="Isolate selected"
                      className="nav-mode-toggle"
                      disabled={!isReady || !selectedElement}
                      onClick={isolateSelected}
                      title="Isolate selected"
                      type="button"
                    >
                      <Eye className="icon" aria-hidden="true" />
                    </button>
                    <button
                      aria-label={
                        isXrayMode ? "Turn off x-ray mode" : "Turn on x-ray mode"
                      }
                      aria-pressed={isXrayMode}
                      className="nav-mode-toggle"
                      disabled={!isReady}
                      onClick={toggleXray}
                      title="X-ray"
                      type="button"
                    >
                      <Scan className="icon" aria-hidden="true" />
                    </button>
                    <span aria-hidden="true" className="toolbar-divider" />
                    <button
                      aria-label={
                        activeTool === "length"
                          ? "Stop length measurement"
                          : "Measure length"
                      }
                      aria-pressed={activeTool === "length"}
                      className="nav-mode-toggle"
                      disabled={!isReady}
                      onClick={() =>
                        setActiveToolMode(
                          activeTool === "length" ? "none" : "length",
                        )
                      }
                      title="Length"
                      type="button"
                    >
                      <Ruler className="icon" aria-hidden="true" />
                    </button>
                    <button
                      aria-label={
                        activeTool === "area"
                          ? "Stop area measurement"
                          : "Measure area"
                      }
                      aria-pressed={activeTool === "area"}
                      className="nav-mode-toggle"
                      disabled={!isReady}
                      onClick={() =>
                        setActiveToolMode(activeTool === "area" ? "none" : "area")
                      }
                      title="Area"
                      type="button"
                    >
                      <LandPlot className="icon" aria-hidden="true" />
                    </button>
                    <span aria-hidden="true" className="toolbar-divider" />
                    <button
                      aria-label="Reset view"
                      className="nav-mode-toggle"
                      disabled={!isReady}
                      onClick={resetView}
                      title="Reset view"
                      type="button"
                    >
                      <RotateCcw className="icon" aria-hidden="true" />
                    </button>
                  </>
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
