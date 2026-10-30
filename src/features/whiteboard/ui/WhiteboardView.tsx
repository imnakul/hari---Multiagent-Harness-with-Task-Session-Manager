import "./excalidrawAssets";
import "@excalidraw/excalidraw/index.css";
import "@fontsource/kalam/400.css";
import "@fontsource/shantell-sans/400.css";
import "@fontsource/caveat/400.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-mono/400.css";
import "./whiteboard.css";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  FONT_FAMILY,
  getSceneVersion,
  newElementWith,
  restore,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  DataURL,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { writeBase64File, writeTextFile } from "../../../platform/tauri/fs";
import { IS_MAC } from "../../../platform/tauri/platform";
import { LoaderCircle } from "../../../shared/ui/icons";
import {
  isLightScheme,
  loadChatBackgroundPath,
  loadNewThreadBackgroundEffect,
  SCHEME_CHANGE_EVENT,
  subscribeChatBackgroundPath,
} from "../../settings/model/appearance";
import { GradientBlurBackground } from "../../settings/ui/GradientBlurBackground";
import {
  createSheet,
  emptyWhiteboardIndex,
  exportFileName,
  markSheetSaved,
  newSheetId,
  openSheet,
  removeSheet,
  renameSheet,
  setSheetLocked,
  sortedSheets,
  type WhiteboardIndex,
} from "../model/sheets";
import {
  loadSheetScene,
  loadWhiteboardIndex,
  revealWhiteboardDir,
  saveSheetScene,
  saveWhiteboardIndex,
  trashSheetFiles,
  whiteboardDir,
} from "../model/sheetStore";
import type { WhiteboardOps } from "../model/whiteboardAgent";
import {
  DEFAULT_WHITEBOARD_FONT_ID,
  extraFontLoadQueries,
  registerWhiteboardFonts,
} from "../model/whiteboardFonts";
import { applyWhiteboardOps, type WhiteboardSkeleton } from "../model/whiteboardScene";
import { iconSvg, svgDataUrl, type CatalogIcon } from "./iconCatalog";
import { IconLibraryPicker } from "./IconLibraryPicker";
import { RadialToolMenu, type WheelTool } from "./RadialToolMenu";
import { WhiteboardChat } from "./WhiteboardChat";
import { WhiteboardTopBar, type ExportKind } from "./WhiteboardTopBar";

registerWhiteboardFonts(FONT_FAMILY as unknown as Record<string, number>);
// First paint should use the right faces, so the canvas waits for them.
const fontsReady = Promise.all(
  extraFontLoadQueries().map((query) => document.fonts.load(query).catch(() => [])),
).then(() => undefined);

const SAVE_DELAY_MS = 800;
const ZOOM_STEP = 1.2;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
const ICON_SIZE = 96;

let rememberedGrid = false;
let rememberedSnap = false;
let rememberedChatOpen = true;

type Scene = {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
};
type Loaded =
  | { id: string; status: "ready"; data: ExcalidrawInitialDataState }
  | { id: string; status: "error"; message: string };

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const sceneVersion = (scene: Scene) =>
  `${getSceneVersion(scene.elements)}:${Object.keys(scene.files).length}`;

function useLightScheme(): boolean {
  const [light, setLight] = useState(isLightScheme);
  useEffect(() => {
    const update = () => setLight(isLightScheme());
    window.addEventListener(SCHEME_CHANGE_EVENT, update);
    return () => window.removeEventListener(SCHEME_CHANGE_EVENT, update);
  }, []);
  return light;
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image"));
    reader.readAsDataURL(blob);
  });
}

/** Fit bounds of a set of elements, for centring the view on them. */
function viewportCentre(appState: AppState) {
  const zoom = appState.zoom.value;
  return {
    x: appState.width / 2 / zoom - appState.scrollX,
    y: appState.height / 2 / zoom - appState.scrollY,
  };
}

/**
 * The Whiteboard tab (fork, L-194): named sheets drawn with Excalidraw, saved
 * under `~/.monocode/whiteboards`, with an agent chat that can draw on them.
 */
export function WhiteboardView({
  tabbed = false,
  besideRail = false,
  compactRail = false,
  cwd,
  onClose,
  onToggleSidebar,
}: {
  tabbed?: boolean;
  besideRail?: boolean;
  compactRail?: boolean;
  cwd?: string;
  onClose: () => void;
  onToggleSidebar?: () => void;
}) {
  const light = useLightScheme();
  const globalBackgroundPath = useSyncExternalStore(
    subscribeChatBackgroundPath,
    loadChatBackgroundPath,
    loadChatBackgroundPath,
  );
  const globalBackgroundEffect = useSyncExternalStore(
    subscribeChatBackgroundPath,
    loadNewThreadBackgroundEffect,
    loadNewThreadBackgroundEffect,
  );

  const [index, setIndex] = useState<WhiteboardIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dir, setDir] = useState<string | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [activeTool, setActiveTool] = useState<string>("selection");
  const [fontId, setFontId] = useState<number>(DEFAULT_WHITEBOARD_FONT_ID);
  const [zoom, setZoom] = useState(1);
  const [grid, setGrid] = useState(rememberedGrid);
  const [snap, setSnap] = useState(rememberedSnap);
  const [chatOpen, setChatOpen] = useState(rememberedChatOpen);
  const [iconsOpen, setIconsOpen] = useState(false);
  const [wheel, setWheel] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const iconButton = useRef<HTMLButtonElement>(null);
  const canvasBox = useRef<HTMLDivElement>(null);

  const indexRef = useRef<WhiteboardIndex | null>(null);
  const indexSaves = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef<{ id: string; scene: Scene } | null>(null);
  const savedVersion = useRef(new Map<string, string>());
  const saveTimer = useRef<number | undefined>(undefined);
  const blockedSaves = useRef(new Set<string>());

  const sheet = index?.sheets.find((item) => item.id === activeId);
  const locked = !!sheet?.locked;
  const ready = loaded?.status === "ready" && loaded.id === activeId && !!api;

  const flash = useCallback((text: string, error = false) => {
    setNotice({ text, error });
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.error ? 6000 : 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** Index changes are written in order, one after another. */
  const commitIndex = useCallback(
    (next: WhiteboardIndex) => {
      if (next === indexRef.current) return;
      indexRef.current = next;
      setIndex(next);
      indexSaves.current = indexSaves.current
        .then(() => saveWhiteboardIndex(next))
        .catch((cause) => flash(`Couldn't save the sheet list: ${errorText(cause)}`, true));
    },
    [flash],
  );

  const writeScene = useCallback(
    async (id: string, scene: Scene) => {
      if (blockedSaves.current.has(id)) return;
      const version = sceneVersion(scene);
      if (savedVersion.current.get(id) === version) return;
      const json = serializeAsJSON(scene.elements, scene.appState, scene.files, "local");
      try {
        await saveSheetScene(id, json);
        savedVersion.current.set(id, version);
        const current = indexRef.current;
        if (current) commitIndex(markSheetSaved(current, id, Date.now()));
      } catch (cause) {
        flash(`Couldn't save the sheet: ${errorText(cause)}`, true);
      }
    },
    [commitIndex, flash],
  );

  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const pending = latest.current;
    if (pending) void writeScene(pending.id, pending.scene);
  }, [writeScene]);

  // Open the sheet list; the first visit gets a fresh sheet.
  useEffect(() => {
    let live = true;
    whiteboardDir().then(
      (path) => live && setDir(path),
      () => undefined,
    );
    loadWhiteboardIndex().then(
      (loadedIndex) => {
        if (!live) return;
        let next = loadedIndex;
        if (next.sheets.length === 0) next = createSheet(next, newSheetId(), Date.now()).index;
        const id =
          next.lastOpenedId && next.sheets.some((item) => item.id === next.lastOpenedId)
            ? next.lastOpenedId
            : sortedSheets(next.sheets)[0]!.id;
        commitIndex(openSheet(next, id));
        setActiveId(id);
      },
      (cause) => {
        if (!live) return;
        setIndexError(errorText(cause));
        indexRef.current = emptyWhiteboardIndex();
      },
    );
    return () => {
      live = false;
    };
  }, [commitIndex]);

  // Load the open sheet's scene.
  useEffect(() => {
    if (!activeId) return;
    const target = indexRef.current?.sheets.find((item) => item.id === activeId);
    if (!target) return;
    let live = true;
    setLoaded(null);
    setApi(null);
    Promise.all([loadSheetScene(target), fontsReady]).then(
      ([raw]) => {
        if (!live) return;
        try {
          const parsed = raw ? (JSON.parse(raw) as Parameters<typeof restore>[0]) : null;
          const data = restore(parsed, null, null);
          blockedSaves.current.delete(activeId);
          setFontId(data.appState.currentItemFontFamily ?? DEFAULT_WHITEBOARD_FONT_ID);
          setLoaded({
            id: activeId,
            status: "ready",
            data: {
              elements: data.elements,
              appState: { ...data.appState, viewBackgroundColor: "transparent" },
              files: data.files,
              scrollToContent: !raw,
            },
          });
        } catch (cause) {
          blockedSaves.current.add(activeId);
          setLoaded({ id: activeId, status: "error", message: errorText(cause) });
        }
      },
      (cause) => {
        if (!live) return;
        blockedSaves.current.add(activeId);
        setLoaded({ id: activeId, status: "error", message: errorText(cause) });
      },
    );
    return () => {
      live = false;
    };
  }, [activeId]);

  // Save what's pending when the tab closes.
  useEffect(() => () => flushSave(), [flushSave]);

  // The first scene after a load is what's on disk; don't write it back.
  useEffect(() => {
    if (!api || !activeId) return;
    savedVersion.current.set(
      activeId,
      sceneVersion({
        elements: api.getSceneElementsIncludingDeleted(),
        appState: api.getAppState(),
        files: api.getFiles(),
      }),
    );
    setZoom(api.getAppState().zoom.value);
  }, [api, activeId]);

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      if (!activeId) return;
      setActiveTool(appState.activeTool.type);
      setFontId(appState.currentItemFontFamily);
      latest.current = { id: activeId, scene: { elements, appState, files } };
      if (savedVersion.current.get(activeId) === sceneVersion({ elements, appState, files })) return;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flushSave, SAVE_DELAY_MS);
    },
    [activeId, flushSave],
  );

  const switchSheet = (id: string) => {
    if (id === activeId) return;
    flushSave();
    latest.current = null;
    const current = indexRef.current;
    if (current) commitIndex(openSheet(current, id));
    setWheel(null);
    setIconsOpen(false);
    setActiveId(id);
  };

  const newSheet = () => {
    const current = indexRef.current;
    if (!current) return;
    flushSave();
    latest.current = null;
    const { index: next, sheet: created } = createSheet(current, newSheetId(), Date.now());
    commitIndex(next);
    setActiveId(created.id);
  };

  const deleteSheet = async () => {
    if (!sheet) return;
    const confirmed = await ask(
      `Delete "${sheet.name}"? Its drawing and chat move to the whiteboards .trash folder.`,
      { title: "Delete sheet", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" },
    );
    if (!confirmed) return;
    const id = sheet.id;
    window.clearTimeout(saveTimer.current);
    latest.current = null;
    blockedSaves.current.add(id);
    try {
      await trashSheetFiles(id);
    } catch (cause) {
      blockedSaves.current.delete(id);
      flash(`Couldn't delete the sheet: ${errorText(cause)}`, true);
      return;
    }
    const current = indexRef.current;
    if (!current) return;
    let { index: next, nextId } = removeSheet(current, id);
    if (!nextId) {
      const created = createSheet(next, newSheetId(), Date.now());
      next = created.index;
      nextId = created.sheet.id;
    }
    commitIndex(next);
    setActiveId(nextId);
    flash(`Deleted "${sheet.name}"`);
  };

  const rename = (name: string) => {
    const current = indexRef.current;
    if (current && sheet) commitIndex(renameSheet(current, sheet.id, name, Date.now()));
  };

  const toggleLock = () => {
    const current = indexRef.current;
    if (!current || !sheet) return;
    if (!sheet.locked) setWheel(null);
    commitIndex(setSheetLocked(current, sheet.id, !sheet.locked));
  };

  const pickTool = (tool: WheelTool) => {
    setWheel(null);
    if (!api) return;
    if (tool === "image") api.setActiveTool({ type: "image", insertOnCanvasDirectly: true });
    else api.setActiveTool({ type: tool });
  };

  const zoomBy = (direction: 1 | -1) => {
    if (!api) return;
    const state = api.getAppState();
    const from = state.zoom.value;
    const to = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, direction > 0 ? from * ZOOM_STEP : from / ZOOM_STEP));
    setZoomTo(to);
  };

  const setZoomTo = (to: number) => {
    if (!api) return;
    const state = api.getAppState();
    // Keep the middle of the view still.
    const centre = viewportCentre(state);
    api.updateScene({
      appState: {
        zoom: { value: to as NormalizedZoomValue },
        scrollX: state.width / 2 / to - centre.x,
        scrollY: state.height / 2 / to - centre.y,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setZoom(to);
  };

  const fit = () => {
    if (!api) return;
    if (api.getSceneElements().length === 0) return setZoomTo(1);
    api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true });
  };

  const selectAll = () => {
    if (!api) return;
    const ids = Object.fromEntries(
      api
        .getSceneElements()
        .filter((element) => !("containerId" in element && element.containerId))
        .map((element) => [element.id, true as const]),
    );
    api.setActiveTool({ type: "selection" });
    api.updateScene({ appState: { selectedElementIds: ids }, captureUpdate: CaptureUpdateAction.NEVER });
  };

  const clearCanvas = async () => {
    if (!api || api.getSceneElements().length === 0) return;
    const confirmed = await ask("Clear everything on this sheet? Ctrl+Z brings it back.", {
      title: "Clear canvas",
      kind: "warning",
      okLabel: "Clear",
      cancelLabel: "Cancel",
    });
    if (!confirmed) return;
    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((element) => (element.isDeleted ? element : newElementWith(element, { isDeleted: true }))),
      appState: { selectedElementIds: {} },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const changeFont = (id: number) => {
    setFontId(id);
    if (!api) return;
    const state = api.getAppState();
    const elements = api.getSceneElementsIncludingDeleted();
    const targets = new Set<string>();
    for (const element of elements) {
      if (element.isDeleted || !state.selectedElementIds[element.id]) continue;
      if (element.type === "text") targets.add(element.id);
      for (const bound of element.boundElements ?? []) if (bound.type === "text") targets.add(bound.id);
    }
    const next = targets.size
      ? restoreElements(
          elements.map((element) =>
            targets.has(element.id) && element.type === "text"
              ? newElementWith(element, { fontFamily: id })
              : element,
          ),
          null,
          { refreshDimensions: true, repairBindings: true },
        )
      : undefined;
    api.updateScene({
      ...(next ? { elements: next } : {}),
      appState: { currentItemFontFamily: id },
      captureUpdate: next ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER,
    });
  };

  const insertIcon = (icon: CatalogIcon) => {
    setIconsOpen(false);
    if (!api || locked) return;
    const state = api.getAppState();
    const fileId = `icon-${newSheetId()}` as FileId;
    api.addFiles([
      {
        id: fileId,
        dataURL: svgDataUrl(iconSvg(icon, state.currentItemStrokeColor, ICON_SIZE)) as DataURL,
        mimeType: "image/svg+xml",
        created: Date.now(),
      },
    ]);
    const centre = viewportCentre(state);
    const [image] = convertToExcalidrawElements([
      {
        type: "image",
        fileId,
        x: centre.x - ICON_SIZE / 2,
        y: centre.y - ICON_SIZE / 2,
        width: ICON_SIZE,
        height: ICON_SIZE,
      },
    ]);
    if (!image) return;
    api.setActiveTool({ type: "selection" });
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), image],
      appState: { selectedElementIds: { [image.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const exportSheet = async (kind: ExportKind) => {
    if (!api || !sheet) return;
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const labels = { png: "PNG image", svg: "SVG image", excalidraw: "Excalidraw file" } as const;
    const path = await save({
      defaultPath: exportFileName(sheet.name, kind),
      filters: [{ name: labels[kind], extensions: [kind] }],
    });
    if (!path) return;
    const exportState = {
      ...appState,
      exportBackground: true,
      viewBackgroundColor: "#ffffff",
      exportWithDarkMode: !light,
    };
    try {
      if (kind === "png") {
        const blob = await exportToBlob({
          elements,
          appState: exportState,
          files,
          mimeType: "image/png",
          exportPadding: 24,
        });
        await writeBase64File(path, await blobBase64(blob));
      } else if (kind === "svg") {
        const svg = await exportToSvg({ elements, appState: exportState, files, exportPadding: 24 });
        await writeTextFile(path, svg.outerHTML);
      } else {
        await writeTextFile(
          path,
          serializeAsJSON(api.getSceneElementsIncludingDeleted(), appState, files, "local"),
        );
      }
      flash(`Exported ${labels[kind]}`);
    } catch (cause) {
      flash(`Couldn't export: ${errorText(cause)}`, true);
    }
  };

  const applyOps = useCallback(
    (ops: WhiteboardOps): string | null => {
      if (!api) return null;
      const current = api.getSceneElementsIncludingDeleted();
      const wasEmpty = api.getSceneElements().length === 0;
      const result = applyWhiteboardOps(
        current,
        ops,
        {
          convert: (skeletons: WhiteboardSkeleton[]) =>
            convertToExcalidrawElements(
              skeletons as unknown as Parameters<typeof convertToExcalidrawElements>[0],
              { regenerateIds: false },
            ),
          withChanges: (element, changes) =>
            newElementWith(element, changes as Parameters<typeof newElementWith>[1]) as typeof element,
        },
        { fontFamily: api.getAppState().currentItemFontFamily },
      );
      if (!result.added && !result.changed && !result.removed) return null;
      const elements = restoreElements(result.elements, null, {
        refreshDimensions: true,
        repairBindings: true,
      });
      api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      if (result.added) {
        const fresh = new Set(result.ids.values());
        const added = api.getSceneElements().filter((element) => fresh.has(element.id));
        if (added.length) {
          api.scrollToContent(added, { fitToViewport: wasEmpty, viewportZoomFactor: 0.85, animate: true });
        }
      }
      const parts = [
        result.added ? `drew ${result.added}` : "",
        result.changed ? `changed ${result.changed}` : "",
        result.removed ? `removed ${result.removed}` : "",
        result.skipped ? `skipped ${result.skipped}` : "",
      ].filter(Boolean);
      const note = parts.join(", ");
      return note.charAt(0).toUpperCase() + note.slice(1);
    },
    [api],
  );

  const getScene = useCallback(() => api?.getSceneElements() ?? [], [api]);

  // Right-click on the canvas opens the tool wheel; Shift + right-click keeps
  // Excalidraw's own menu. Capture runs before Excalidraw's React handler.
  useEffect(() => {
    const box = canvasBox.current;
    if (!box) return;
    const onContextMenu = (event: MouseEvent) => {
      if (event.shiftKey || locked || !ready) return;
      if (!(event.target instanceof HTMLCanvasElement)) return;
      event.preventDefault();
      event.stopPropagation();
      setWheel({ x: event.clientX, y: event.clientY });
    };
    box.addEventListener("contextmenu", onContextMenu, true);
    return () => box.removeEventListener("contextmenu", onContextMenu, true);
  }, [locked, ready]);

  const closeWheel = useCallback(() => setWheel(null), []);
  const toggleChat = () =>
    setChatOpen((open) => {
      rememberedChatOpen = !open;
      return !open;
    });

  const topBar = (
    <WhiteboardTopBar
      sheets={index?.sheets ?? []}
      sheet={sheet}
      activeTool={activeTool}
      fontId={fontId}
      grid={grid}
      snap={snap}
      zoom={zoom}
      chatOpen={chatOpen}
      ready={ready}
      onOpenSheet={switchSheet}
      onNewSheet={newSheet}
      onRename={rename}
      onDeleteSheet={() => void deleteSheet()}
      onRevealFolder={() =>
        void revealWhiteboardDir().catch((cause) => flash(`Couldn't open the folder: ${errorText(cause)}`, true))
      }
      onTool={(tool) => api?.setActiveTool({ type: tool })}
      onToggleLock={toggleLock}
      onFont={changeFont}
      onIcons={() => setIconsOpen((open) => !open)}
      onGrid={() =>
        setGrid((value) => {
          rememberedGrid = !value;
          return !value;
        })
      }
      onSnap={() =>
        setSnap((value) => {
          rememberedSnap = !value;
          return !value;
        })
      }
      onZoom={zoomBy}
      onZoomReset={() => setZoomTo(1)}
      onFit={fit}
      onSelectAll={selectAll}
      onExport={(kind) => void exportSheet(kind)}
      onClear={() => void clearCanvas()}
      onToggleChat={toggleChat}
      iconButtonRef={iconButton}
    />
  );

  return (
    <div
      role="region"
      aria-label="Whiteboard"
      data-app-whiteboard
      data-session-empty="false"
      data-project-chat-background="false"
      className="chat-pane-background relative isolate flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      {globalBackgroundPath && globalBackgroundEffect === "gradient-blur" ? <GradientBlurBackground /> : null}
      {tabbed ? (
        <div className="flex h-10 shrink-0 items-center border-b border-stroke">{topBar}</div>
      ) : (
        <div
          data-app-view-header
          className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
          data-tauri-drag-region="deep"
        >
          {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
          {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
          {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
          {topBar}
          {IS_MAC ? null : <WindowControls />}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div ref={canvasBox} className="relative min-h-0 min-w-0 flex-1">
          {indexError ? (
            <div role="alert" className="flex h-full items-center justify-center p-6 text-center text-[13px] text-red-300/90">
              Couldn't open the whiteboards folder: {indexError}
            </div>
          ) : loaded?.status === "error" && loaded.id === activeId ? (
            <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-[13px] text-red-300/90">Couldn't open this sheet: {loaded.message}</p>
              <p className="max-w-sm text-[12px] text-content/50">
                Its file is left as it is and won't be overwritten. Open another sheet, or fix the file in
                the whiteboards folder.
              </p>
            </div>
          ) : loaded?.status === "ready" && loaded.id === activeId ? (
            <Excalidraw
              key={loaded.id}
              initialData={loaded.data}
              excalidrawAPI={setApi}
              onChange={onChange}
              onScrollChange={(_x, _y, value) => setZoom(value.value)}
              theme={light ? "light" : "dark"}
              viewModeEnabled={locked}
              gridModeEnabled={grid}
              objectsSnapModeEnabled={snap}
              handleKeyboardGlobally={false}
              autoFocus
              UIOptions={{
                canvasActions: {
                  changeViewBackgroundColor: false,
                  clearCanvas: false,
                  export: false,
                  loadScene: false,
                  saveAsImage: false,
                  saveToActiveFile: false,
                  toggleTheme: null,
                },
              }}
            />
          ) : (
            <div role="status" className="flex h-full items-center justify-center gap-2 text-[12px] text-content/50">
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              Opening sheet…
            </div>
          )}
          {notice ? (
            <p
              role={notice.error ? "alert" : "status"}
              className={`pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg border border-content/10 bg-background-base/70 px-3 py-1.5 text-[12px] backdrop-blur-xl ${
                notice.error ? "text-red-300/90" : "text-content/75"
              }`}
            >
              {notice.text}
            </p>
          ) : null}
        </div>
        {chatOpen && sheet && (cwd || dir) ? (
          <WhiteboardChat
            sheetId={sheet.id}
            sheetName={sheet.name}
            locked={locked}
            cwd={cwd ?? dir!}
            getScene={getScene}
            applyOps={applyOps}
            onClose={toggleChat}
          />
        ) : null}
      </div>

      {wheel ? (
        <RadialToolMenu x={wheel.x} y={wheel.y} activeTool={activeTool} onPick={pickTool} onClose={closeWheel} />
      ) : null}
      {iconsOpen ? (
        <IconLibraryPicker anchor={iconButton} onPick={insertIcon} onClose={() => setIconsOpen(false)} />
      ) : null}
    </div>
  );
}
