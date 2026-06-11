"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ModelStatus = "idle" | "streaming" | "loaded" | "error";

type DatasetId = "demo" | "casa";

type DemoModel = {
  dataset: DatasetId;
  description: string;
  disabledReason?: string;
  id: string;
  name: string;
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

const MODELS: DemoModel[] = [
  {
    dataset: "demo",
    description: "Architectural shell, rooms, walls, slabs, and openings",
    id: "school_arq",
    name: "School Architecture",
    sourceFormat: "Fragments",
    size: "3.4 MB",
    url: "/models/school_arq.frag",
  },
  {
    dataset: "demo",
    description: "Structural frame loaded as a separate BIM discipline",
    id: "school_str",
    name: "School Structure",
    sourceFormat: "Fragments",
    size: "0.7 MB",
    url: "/models/school_str.frag",
  },
  {
    dataset: "casa",
    description: "IFC4 export converted into a streamable ThatOpen Fragment",
    id: "casa_rebecca",
    name: "Casa Rebecca",
    sourceFormat: "Fragments",
    size: "12.4 MB",
    url: "/models/casa_rebecca.frag",
  },
];

const DATASETS: Array<{
  action: string;
  description: string;
  id: DatasetId;
  label: string;
}> = [
  {
    action: "Stream demo BIM",
    description: "Hosted sample: ThatOpen school model",
    id: "demo",
    label: "Demo models",
  },
  {
    action: "Load Casa Rebecca",
    description: "IFC4 export converted to Fragments",
    id: "casa",
    label: "Casa Rebecca",
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

async function streamModel(
  url: string,
  onProgress: (bytesLoaded: number, bytesTotal: number) => void,
) {
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

export default function BimStreamer() {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const initialLoadStartedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [modelStates, setModelStates] = useState(initialModelState);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [activeDatasetId, setActiveDatasetId] = useState<DatasetId>("casa");

  const activeDataset = DATASETS.find(
    (dataset) => dataset.id === activeDatasetId,
  )!;

  const currentModels = useMemo(
    () => MODELS.filter((model) => model.dataset === activeDatasetId),
    [activeDatasetId],
  );

  const hasStreamableModels = currentModels.some((model) => model.url);

  const activeCount = useMemo(
    () =>
      currentModels.filter((model) => modelStates[model.id].status === "loaded")
        .length,
    [currentModels, modelStates],
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

        const buffer = await streamModel(model.url, (bytesLoaded, bytesTotal) => {
          setModelState(model.id, {
            bytesLoaded,
            bytesTotal,
            percent: bytesTotal
              ? Math.min(100, Math.round((bytesLoaded / bytesTotal) * 100))
              : 0,
          });
        });
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
          error:
            error instanceof Error
              ? error.message
              : "This model could not be loaded.",
          status: "error",
        });
      }
    },
    [modelStates, setModelState],
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

  const switchDataset = async (dataset: DatasetId) => {
    if (dataset === activeDatasetId) return;
    await unloadAllModels();
    setActiveDatasetId(dataset);
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
      activeDatasetId !== "casa" ||
      initialLoadStartedRef.current
    ) {
      return;
    }

    initialLoadStartedRef.current = true;
    void loadAll();
  }, [activeDatasetId, isReady, loadAll]);

  return (
    <main className="bim-app">
      <section className="viewer-shell" aria-label="BIM stream viewer">
        <div className="viewer-surface" ref={viewerRef}>
          {!isReady ? (
            <div className="viewer-state">
              <span>{bootError ?? "Starting ThatOpen viewer..."}</span>
            </div>
          ) : null}
        </div>

        <aside className="control-panel" aria-label="Model streaming controls">
          <header>
            <span>ThatOpen fragments</span>
            <h1>BIM file streamer</h1>
            <p>{activeDataset.description}</p>
          </header>

          <div className="dataset-switcher" aria-label="Model set">
            {DATASETS.map((dataset) => (
              <button
                aria-pressed={activeDatasetId === dataset.id}
                key={dataset.id}
                onClick={() => void switchDataset(dataset.id)}
                type="button"
              >
                {dataset.label}
              </button>
            ))}
          </div>

          <div className="status-strip">
            <strong>{activeCount}</strong>
            <span>{activeCount === 1 ? "model loaded" : "models loaded"}</span>
          </div>

          <button
            className="primary-action"
            disabled={
              !isReady ||
              !hasStreamableModels ||
              Object.values(modelStates).some(
                (state) => state.status === "streaming",
              )
            }
            onClick={loadAll}
            type="button"
          >
            {hasStreamableModels ? activeDataset.action : "Needs conversion"}
          </button>

          <div className="model-list">
            {currentModels.map((model) => {
              const state = modelStates[model.id];
              const isLoaded = state.status === "loaded";
              const isStreaming = state.status === "streaming";
              const isActive = activeModelId === model.id;
              const isBlocked = !model.url;

              return (
                <article
                  className={`model-row ${isActive ? "model-row-active" : ""} ${
                    isBlocked ? "model-row-blocked" : ""
                  }`}
                  key={model.id}
                >
                  <div>
                    <h2>{model.name}</h2>
                    <p>{model.description}</p>
                  </div>

                  <div className="model-meta">
                    <span>{model.size}</span>
                    <span>{isBlocked ? model.sourceFormat : state.status}</span>
                  </div>

                  <div className="progress-track">
                    <span style={{ width: `${state.percent}%` }} />
                  </div>

                  <div className="row-footer">
                    <span>
                      {isBlocked
                        ? "RVT source not streamable"
                        : state.bytesLoaded
                        ? `${formatBytes(state.bytesLoaded)} streamed`
                        : "Ready to stream"}
                    </span>
                    <button
                      disabled={!isReady || isStreaming || isBlocked}
                      onClick={() =>
                        isLoaded ? unloadModel(model) : loadModel(model)
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
                  </div>

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
    </main>
  );
}
