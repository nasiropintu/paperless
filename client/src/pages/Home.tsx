import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpenText, Check, ChevronDown, CircleHelp,
  Clipboard, CloudOff, Copy, Download, FileImage, FileLock2, FilePlus2, FileScan, Files,
  Folder, ImagePlus, LoaderCircle, LockKeyhole, MoreHorizontal, PanelLeftClose, Pencil,
  Plus, Printer, RotateCw, ScanLine, Search, Share2, ShieldCheck, Sparkles, Tag, Trash2,
  UnlockKeyhole, Upload, X,
} from "lucide-react";
import CameraSheet from "@/components/CameraSheet";
import AboutDialog from "@/components/AboutDialog";
import NameSetup from "@/components/NameSetup";
import { deleteDocument as removeStoredDocument, listDocuments, saveDocument } from "@/lib/documentStore";
import { createImageCopies, createPdf, downloadBlob, lockPdf, shareOrDownload, unlockPdf } from "@/lib/documentExport";
import { DEFAULT_CORNERS, type FilterMode, type MarkupMode, type Point, type ScanDocument, type ScanPage, type Stroke } from "@/lib/scanTypes";
import { detectDocumentCorners } from "@/lib/scanProcessing";

const APP_NAME_KEY = "paperless.workspace-name";
const SETUP_KEY = "paperless.workspace-setup-v1";
function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function sizeLabel(bytes: number) {
  if (!bytes) return "0 KB";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) { setUrl(""); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function PageThumbnail({ page, selected, onClick, compact = false }: { page: ScanPage; selected: boolean; onClick: () => void; compact?: boolean }) {
  const url = useObjectUrl(page.image);
  return <button className={`page-thumb ${selected ? "is-selected" : ""} ${compact ? "is-compact" : ""}`} onClick={onClick} title="Open page">
    {url ? <img src={url} alt="Scanned page preview" style={{ filter: page.filter === "grayscale" ? "grayscale(1)" : page.filter === "bw" ? "grayscale(1) contrast(2.1)" : page.filter === "contrast" ? "contrast(1.4)" : page.filter === "shadow" ? "brightness(1.08)" : undefined, transform: `rotate(${page.rotation}deg)` }} /> : <span className="thumb-placeholder" />}
  </button>;
}

function scanPage(image: Blob): Promise<ScanPage> {
  return detectDocumentCorners(image).then((corners) => ({
    id: makeId(), image, corners, rotation: 0, filter: "original", strokes: [], createdAt: Date.now(),
  }));
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}

function filterPreview(mode: FilterMode) {
  if (mode === "grayscale") return "grayscale(1)";
  if (mode === "bw") return "grayscale(1) contrast(2.1)";
  if (mode === "contrast") return "contrast(1.38)";
  if (mode === "shadow") return "brightness(1.13) contrast(0.95)";
  if (mode === "auto") return "contrast(1.12) brightness(1.03)";
  return "none";
}

function HeaderMark({ small = false }: { small?: boolean }) {
  return <span className={`header-mark ${small ? "small" : ""}`} aria-hidden="true"><FileScan size={small ? 17 : 19} strokeWidth={2.2} /></span>;
}

function CornerOverlay({ page, onChange, disabled }: { page: ScanPage; onChange: (corners: [Point, Point, Point, Point]) => void; disabled: boolean }) {
  const current = useRef<number | null>(null);
  const changeAt = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled || current.current === null) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const next = [...page.corners] as [Point, Point, Point, Point];
    next[current.current] = {
      x: Math.max(0.01, Math.min(0.99, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0.01, Math.min(0.99, (event.clientY - bounds.top) / bounds.height)),
    };
    onChange(next);
  };
  const points = page.corners.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
  return <svg className={`corner-overlay ${disabled ? "" : "can-adjust"}`} viewBox="0 0 100 100" preserveAspectRatio="none" onPointerMove={changeAt} onPointerUp={() => { current.current = null; }} onPointerCancel={() => { current.current = null; }}>
    <polygon points={points} className="crop-polygon" />
    {page.corners.map((point, index) => <circle key={index} cx={point.x * 100} cy={point.y * 100} r="2.4" className="crop-handle" onPointerDown={(event) => { if (disabled) return; current.current = index; event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId); }} />)}
  </svg>;
}

export default function Home() {
  const [documents, setDocuments] = useState<ScanDocument[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState(() => localStorage.getItem(APP_NAME_KEY) || "Paperless");
  const [showSetup, setShowSetup] = useState(() => localStorage.getItem(SETUP_KEY) !== "done");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [draftPages, setDraftPages] = useState<ScanPage[]>([]);
  const [scanTargetId, setScanTargetId] = useState<string | null>(null);
  const [scanReplacePageId, setScanReplacePageId] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("All folders");
  const [sortBy, setSortBy] = useState<"recent" | "title" | "pages">("recent");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedPageId, setSelectedPageId] = useState("");
  const [cropMode, setCropMode] = useState(false);
  const [markupMode, setMarkupMode] = useState<MarkupMode>("off");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const [quality, setQuality] = useState(0.86);
  const [online, setOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [toast, setToast] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [saving, setSaving] = useState(false);
  const [renameInput, setRenameInput] = useState(false);
  const [progressNote, setProgressNote] = useState("");
  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [folderInput, setFolderInput] = useState("");
  const [folderEditing, setFolderEditing] = useState(false);
  const [customFolders, setCustomFolders] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem("paperless.custom-folders") || "[]");
      return Array.isArray(value) ? value.filter((folder): folder is string => typeof folder === "string") : [];
    } catch { return []; }
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeStrokeRef = useRef<Stroke | null>(null);

  const selectedDocument = documents.find((document) => document.id === selectedId) ?? null;
  const activePage = selectedDocument?.pages.find((page) => page.id === selectedPageId) ?? selectedDocument?.pages[0] ?? null;
  const activePageUrl = useObjectUrl(activePage?.image);
  const totalPages = documents.reduce((sum, document) => sum + document.pages.length, 0);
  const storageUsed = documents.reduce((sum, document) => sum + document.pages.reduce((pageSum, page) => pageSum + page.image.size, 0), 0);
  const folders = useMemo(() => ["All folders", ...Array.from(new Set(["Inbox", ...customFolders, ...documents.map((document) => document.folder).filter(Boolean)])).sort((a, b) => a.localeCompare(b))], [documents, customFolders]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3400);
  }, []);

  useEffect(() => {
    let alive = true;
    listDocuments().then((stored) => {
      if (!alive) return;
      setDocuments(stored.sort((a, b) => b.updatedAt - a.updatedAt));
      setLibraryReady(true);
    }).catch((error: unknown) => {
      if (!alive) return;
      setStorageError(error instanceof Error ? error.message : "Local document storage is not available.");
      setLibraryReady(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => { document.title = `${workspaceName} — Local Scan Desk`; }, [workspaceName]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const onInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);

  useEffect(() => {
    if (selectedDocument && !selectedPageId && selectedDocument.pages[0]) setSelectedPageId(selectedDocument.pages[0].id);
    if (selectedDocument && selectedPageId && !selectedDocument.pages.some((page) => page.id === selectedPageId)) setSelectedPageId(selectedDocument.pages[0]?.id ?? "");
  }, [selectedDocument, selectedPageId]);

  const persistDocument = async (document: ScanDocument) => {
    setSaving(true);
    try {
      await saveDocument({ ...document, updatedAt: Date.now() });
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not save this scan.");
      notify("Autosave failed. Check this browser’s storage settings.");
    } finally {
      setSaving(false);
    }
  };

  const updateDocument = (id: string, change: Partial<ScanDocument> | ((document: ScanDocument) => ScanDocument)) => {
    const current = documents.find((document) => document.id === id);
    if (!current) return;
    const updated = typeof change === "function" ? change(current) : { ...current, ...change };
    const next = { ...updated, updatedAt: Date.now() };
    setDocuments((previous) => previous.map((document) => document.id === id ? next : document).sort((a, b) => b.updatedAt - a.updatedAt));
    void persistDocument(next);
  };

  const beginScan = (targetId: string | null = null, replacePageId: string | null = null) => {
    setDraftPages([]);
    setScanTargetId(targetId);
    setScanReplacePageId(replacePageId);
    setScannerOpen(true);
  };

  const onCapturedPage = async (image: Blob) => {
    setScanBusy(true);
    setProgressNote("Finding page edges…");
    try {
      const page = await scanPage(image);
      setDraftPages((pages) => [...pages, page]);
      setProgressNote("");
    } catch {
      notify("This image could not be processed. Try another photo.");
    } finally {
      setScanBusy(false);
    }
  };

  const finishScan = async () => {
    if (!draftPages.length) return;
    const timestamp = Date.now();
    if (scanTargetId) {
      const target = documents.find((document) => document.id === scanTargetId);
      if (target) {
        const pages = [...target.pages];
        const replaceIndex = scanReplacePageId ? pages.findIndex((page) => page.id === scanReplacePageId) : -1;
        if (replaceIndex >= 0) pages.splice(replaceIndex, 1, ...draftPages);
        else pages.push(...draftPages);
        const updated = { ...target, pages, ocrText: "", updatedAt: timestamp };
        setDocuments((previous) => previous.map((document) => document.id === target.id ? updated : document));
        await persistDocument(updated);
        setSelectedId(updated.id);
        setSelectedPageId(draftPages[0].id);
        notify(`Pages saved to ${updated.title}. Run OCR again to refresh searchable text.`);
      }
    } else {
      const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
      const created: ScanDocument = {
        id: makeId(), title: `Scan — ${date}`, folder: "Inbox", tags: [], pages: draftPages,
        ocrText: "", createdAt: timestamp, updatedAt: timestamp,
      };
      setDocuments((previous) => [created, ...previous]);
      await persistDocument(created);
      setSelectedId(created.id);
      setSelectedPageId(draftPages[0].id);
      notify("Scan saved to your local library.");
    }
    setScannerOpen(false);
    setDraftPages([]);
    setScanTargetId(null);
    setScanReplacePageId(null);
  };

  const handleImport = async (files: FileList | null) => {
    if (!files) return;
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) { notify("Choose an image file to scan."); return; }
    const imported: ScanPage[] = [];
    setScanBusy(true);
    setProgressNote("Preparing your images…");
    try {
      for (const image of images) imported.push(await scanPage(image));
      const timestamp = Date.now();
      const document: ScanDocument = { id: makeId(), title: images.length > 1 ? `Import — ${formatDate(timestamp)}` : images[0].name.replace(/\.[^.]+$/, "") || "Imported scan", folder: "Inbox", tags: [], pages: imported, ocrText: "", createdAt: timestamp, updatedAt: timestamp };
      setDocuments((previous) => [document, ...previous]);
      await persistDocument(document);
      setSelectedId(document.id);
      setSelectedPageId(imported[0]?.id ?? "");
      notify(`${imported.length} image${imported.length === 1 ? "" : "s"} added to your library.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not import those images.");
    } finally {
      setProgressNote("");
      setScanBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const saveWorkspaceName = (name: string) => {
    setWorkspaceName(name);
    localStorage.setItem(APP_NAME_KEY, name);
    localStorage.setItem(SETUP_KEY, "done");
    setShowSetup(false);
  };

  const beginRename = () => {
    setRenameInput(true);
    setTimeout(() => document.getElementById("rename-workspace")?.focus(), 0);
  };

  const saveRename = () => {
    const name = workspaceName.trim();
    if (!name) return;
    localStorage.setItem(APP_NAME_KEY, name);
    setRenameInput(false);
  };

  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return documents.filter((document) => {
      const folderMatch = folderFilter === "All folders" || document.folder === folderFilter;
      const text = `${document.title} ${document.folder} ${document.tags.join(" ")} ${document.ocrText}`.toLocaleLowerCase();
      return folderMatch && (!query || text.includes(query));
    }).sort((a, b) => sortBy === "title" ? a.title.localeCompare(b.title) : sortBy === "pages" ? b.pages.length - a.pages.length : b.updatedAt - a.updatedAt);
  }, [documents, search, folderFilter, sortBy]);

  const updateActivePage = (change: Partial<ScanPage> | ((page: ScanPage) => ScanPage)) => {
    if (!selectedDocument || !activePage) return;
    updateDocument(selectedDocument.id, (document) => ({
      ...document,
      pages: document.pages.map((page) => {
        if (page.id !== activePage.id) return page;
        return typeof change === "function" ? change(page) : { ...page, ...change };
      }),
    }));
  };

  const movePage = (direction: -1 | 1) => {
    if (!selectedDocument || !activePage) return;
    const index = selectedDocument.pages.findIndex((page) => page.id === activePage.id);
    const target = index + direction;
    if (target < 0 || target >= selectedDocument.pages.length) return;
    const pages = [...selectedDocument.pages];
    [pages[index], pages[target]] = [pages[target], pages[index]];
    updateDocument(selectedDocument.id, { pages, ocrText: "" });
  };

  const duplicatePage = () => {
    if (!selectedDocument || !activePage) return;
    const duplicate = { ...activePage, id: makeId(), strokes: activePage.strokes.map((stroke) => ({ ...stroke, id: makeId(), points: [...stroke.points] })), createdAt: Date.now() };
    const index = selectedDocument.pages.findIndex((page) => page.id === activePage.id);
    const pages = [...selectedDocument.pages];
    pages.splice(index + 1, 0, duplicate);
    updateDocument(selectedDocument.id, { pages, ocrText: "" });
    setSelectedPageId(duplicate.id);
    notify("Page duplicated.");
  };

  const deletePage = () => {
    if (!selectedDocument || !activePage) return;
    if (selectedDocument.pages.length === 1) {
      void deleteSelectedDocument();
      return;
    }
    if (!window.confirm("Delete this page from the scan?")) return;
    const index = selectedDocument.pages.findIndex((page) => page.id === activePage.id);
    const pages = selectedDocument.pages.filter((page) => page.id !== activePage.id);
    updateDocument(selectedDocument.id, { pages, ocrText: "" });
    setSelectedPageId(pages[Math.max(0, index - 1)].id);
  };

  const deleteSelectedDocument = async () => {
    if (!selectedDocument) return;
    const ok = window.confirm(`Delete “${selectedDocument.title}” and its ${selectedDocument.pages.length} page${selectedDocument.pages.length === 1 ? "" : "s"} from this device? This cannot be undone.`);
    if (!ok) return;
    setDocuments((previous) => previous.filter((document) => document.id !== selectedDocument.id));
    try { await removeStoredDocument(selectedDocument.id); } catch { notify("The scan could not be removed from local storage."); }
    setSelectedId(null);
    setSelectedPageId("");
    notify("Scan deleted from this device.");
  };

  const handleOcr = async () => {
    if (!selectedDocument) return;
    setOcrBusy(true);
    setOcrProgress(0);
    setProgressNote("Starting bundled English OCR…");
    let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
    try {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker("eng", 1, {
        workerPath: `${import.meta.env.BASE_URL}vendor/tesseract/worker.min.js`,
        corePath: `${import.meta.env.BASE_URL}vendor/tesseract/`,
        langPath: `${import.meta.env.BASE_URL}tessdata/`,
        gzip: true,
        logger: (message) => { if (message.status === "recognizing text") setOcrProgress(Math.round(message.progress * 100)); },
      });
      let text = "";
      for (let index = 0; index < selectedDocument.pages.length; index++) {
        setProgressNote(`Reading page ${index + 1} of ${selectedDocument.pages.length} on this device…`);
        const result = await worker.recognize(selectedDocument.pages[index].image);
        text += `${result.data.text}\n`;
        setOcrProgress(Math.round(((index + 1) / selectedDocument.pages.length) * 100));
      }
      updateDocument(selectedDocument.id, { ocrText: text.trim() });
      notify("Text extracted locally and saved with this scan.");
    } catch (error) {
      notify(error instanceof Error ? `OCR could not start: ${error.message}` : "OCR could not start. Check the bundled OCR files and try again.");
    } finally {
      if (worker) await worker.terminate().catch(() => undefined);
      setOcrBusy(false);
      setProgressNote("");
    }
  };

  const exportPdf = async (action: "download" | "share" | "print" = "download") => {
    if (!selectedDocument) return;
    const printWindow = action === "print" ? window.open("about:blank", "_blank") : null;
    setExportBusy(true);
    setProgressNote("Building your PDF locally…");
    try {
      const pdf = await createPdf(selectedDocument, quality);
      const filename = `${selectedDocument.title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "Paperless-scan"}.pdf`;
      if (action === "share") {
        const result = await shareOrDownload(pdf, filename, selectedDocument.title);
        notify(result === "shared" ? "PDF shared." : "File sharing is unavailable here; the PDF was downloaded instead.");
      } else if (action === "print") {
        const url = URL.createObjectURL(pdf);
        if (printWindow) {
          printWindow.opener = null;
          printWindow.addEventListener("load", () => printWindow.print(), { once: true });
          printWindow.location.href = url;
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } else {
          downloadBlob(pdf, filename);
          notify("The browser blocked the print window, so the PDF was downloaded.");
        }
      } else {
        downloadBlob(pdf, filename);
        notify("PDF downloaded.");
      }
    } catch (error) {
      printWindow?.close();
      notify(error instanceof Error ? error.message : "PDF export failed.");
    } finally {
      setExportBusy(false);
      setProgressNote("");
    }
  };

  const exportImages = async () => {
    if (!selectedDocument) return;
    setExportBusy(true);
    setProgressNote("Preparing image files locally…");
    try {
      const copies = await createImageCopies(selectedDocument, quality);
      copies.forEach((image, index) => window.setTimeout(() => downloadBlob(image, `${selectedDocument.title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "Paperless-scan"}-page-${index + 1}.jpg`), index * 180));
      notify(`${copies.length} page image${copies.length === 1 ? "" : "s"} downloaded.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Image export failed.");
    } finally {
      setExportBusy(false);
      setProgressNote("");
    }
  };

  const protectPdf = async () => {
    if (!selectedDocument) return;
    const password = window.prompt("Choose a password (at least 8 characters). This protected copy can be opened only in Paperless.");
    if (!password) return;
    if (password.length < 8) { notify("Choose a password with at least 8 characters."); return; }
    setExportBusy(true);
    try {
      const pdf = await createPdf(selectedDocument, quality);
      const encrypted = await lockPdf(pdf, password);
      downloadBlob(encrypted, `${selectedDocument.title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "Paperless-scan"}.paperless`);
      notify("Encrypted copy downloaded. Keep the password safe; it cannot be recovered.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not encrypt this PDF copy.");
    } finally { setExportBusy(false); }
  };

  const openUnlockPicker = () => fileInputRef.current?.click();
  const handleUnlockFile = async (file: File | undefined) => {
    if (!file) return;
    const password = window.prompt("Enter the password for this Paperless encrypted PDF.");
    if (!password) return;
    try {
      const pdf = await unlockPdf(file, password);
      downloadBlob(pdf, file.name.replace(/\.paperless$/i, ".pdf"));
      notify("Protected copy unlocked and downloaded.");
    } catch { notify("Could not unlock that file. Check the password and try again."); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addTags = () => {
    if (!selectedDocument) return;
    const tags = Array.from(new Set([...selectedDocument.tags, ...tagInput.split(",").map((tag) => tag.trim()).filter(Boolean)]));
    updateDocument(selectedDocument.id, { tags });
    setTagInput("");
  };

  const addFolder = () => {
    if (!selectedDocument) return;
    const folder = folderInput.trim();
    if (folder) {
      updateDocument(selectedDocument.id, { folder });
      const next = Array.from(new Set([...customFolders, folder]));
      setCustomFolders(next);
      localStorage.setItem("paperless.custom-folders", JSON.stringify(next));
    }
    setFolderInput("");
    setFolderEditing(false);
  };

  const createFolder = () => {
    const folder = window.prompt("Name a new folder");
    if (!folder?.trim()) return;
    const name = folder.trim();
    const next = Array.from(new Set([...customFolders, name]));
    setCustomFolders(next);
    localStorage.setItem("paperless.custom-folders", JSON.stringify(next));
    setFolderFilter(name);
    setSelectedId(null);
    notify(`Folder “${name}” created.`);
  };

  const changeCorners = (corners: [Point, Point, Point, Point]) => updateActivePage({ corners });

  const startMarkup = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!activePage || markupMode === "off" || cropMode) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
    activeStrokeRef.current = { id: makeId(), mode: markupMode, points: [point], width: markupMode === "redact" ? 0.045 : markupMode === "signature" ? 0.012 : 0.008 };
    setLiveStroke(activeStrokeRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const continueMarkup = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!activeStrokeRef.current || !activePage) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
    const stroke = activeStrokeRef.current;
    const next = { ...stroke, points: [...stroke.points, point] };
    activeStrokeRef.current = next;
    setLiveStroke(next);
  };
  const endMarkup = () => {
    const stroke = activeStrokeRef.current;
    if (stroke) updateActivePage((page) => ({ ...page, strokes: [...page.strokes, stroke] }));
    activeStrokeRef.current = null;
    setLiveStroke(null);
  };

  const addInstall = async () => {
    if (!installPrompt) { notify("Use your browser menu and choose Install app or Add to Home Screen."); return; }
    const prompt = installPrompt as Event & { prompt?: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
    await prompt.prompt?.();
    setInstallPrompt(null);
  };

  if (!libraryReady) return <main className="loading-screen"><LoaderCircle className="spin" size={22} /> Opening your private library…</main>;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="side-brand">
        <HeaderMark />
        <div className="brand-name-block">
          {renameInput ? <input id="rename-workspace" className="rename-field" value={workspaceName} maxLength={32} onChange={(event) => setWorkspaceName(event.target.value)} onBlur={saveRename} onKeyDown={(event) => { if (event.key === "Enter") saveRename(); if (event.key === "Escape") setRenameInput(false); }} /> : <button className="brand-name" onClick={beginRename} title="Rename this workspace">{workspaceName}<Pencil size={11} /></button>}
          <span className="brand-edition">LOCAL SCAN DESK</span>
        </div>
        <button className="icon-button side-collapse" aria-label="Collapse sidebar"><PanelLeftClose size={17} /></button>
      </div>
      <div className="side-nav">
        <p className="nav-label">WORKSPACE</p>
        <button className={`nav-item ${!selectedId && folderFilter === "All folders" ? "active" : ""}`} onClick={() => { setFolderFilter("All folders"); setSelectedId(null); }}><Files size={17} /><span>All scans</span><span className="nav-count">{documents.length}</span></button>
        <button className="nav-item" onClick={() => { setFolderFilter("Inbox"); setSelectedId(null); }}><Folder size={17} /><span>Inbox</span><span className="nav-count">{documents.filter((document) => document.folder === "Inbox").length}</span></button>
        <button className="nav-item" onClick={() => { setSearch(""); setFolderFilter("All folders"); setSelectedId(null); }}><BookOpenText size={17} /><span>Recently opened</span></button>
        <p className="nav-label folder-label">FOLDERS <button className="tiny-icon" onClick={createFolder} aria-label="Add folder"><Plus size={14} /></button></p>
        {folders.filter((folder) => folder !== "All folders" && folder !== "Inbox").map((folder) => <button className={`nav-item ${folderFilter === folder ? "active" : ""}`} key={folder} onClick={() => { setFolderFilter(folder); setSelectedId(null); }}><Folder size={16} /><span className="nav-truncate">{folder}</span></button>)}
      </div>
      <div className="sidebar-bottom">
        <div className="local-card"><div className="local-card-icon"><ShieldCheck size={17} /></div><div><strong>Private by default</strong><p>Your scans stay in this browser.</p></div></div>
        <div className="storage-meter"><div className="storage-copy"><span>Local library</span><span>{sizeLabel(storageUsed)}</span></div><div className="storage-track"><span style={{ width: `${Math.min(100, storageUsed / (250 * 1024 * 1024) * 100)}%` }} /></div><span className="storage-footnote">Device storage · autosaving</span></div>
        <button className="side-help" onClick={() => notify("Install Paperless from your browser menu. Scans are stored only in this browser profile; export backups regularly.")}><CircleHelp size={15} /> Help & local storage</button>
        <button className="creator-credit" onClick={() => setAboutOpen(true)}><span className="creator-heart">♥</span><span>Crafted with ❤️ by NasirPintu</span></button>
      </div>
    </aside>

    <section className="main-panel">
      <header className="topbar">
        <div className="breadcrumbs">
          {selectedDocument ? <><button onClick={() => setSelectedId(null)}>Library</button><span className="crumb-divider">/</span><span className="crumb-current">{selectedDocument.title}</span></> : <><span className="topbar-mark"><HeaderMark small /></span><span className="crumb-current">Your library</span></>}
        </div>
        <div className="topbar-actions">
          <span className={`connection-indicator ${online ? "online" : "offline"}`} title={online ? "You are online" : "Offline — your library remains available"}><span />{online ? "Local mode" : "Offline"}</span>
          <button className="button button-outline install-button" onClick={() => void addInstall()}><Download size={15} /> Install app</button>
          <button className="button button-primary top-scan" onClick={() => beginScan()}><ScanLine size={16} /> New scan</button>
          <input ref={fileInputRef} type="file" accept="image/*,.paperless,application/vnd.paperless.encrypted" multiple hidden onChange={(event) => {
            const files = event.target.files;
            if (!files?.length) return;
            if (Array.from(files).some((file) => file.type.startsWith("image/"))) void handleImport(files);
            else void handleUnlockFile(files[0]);
          }} />
        </div>
      </header>

      {storageError && <div className="storage-warning"><CloudOff size={17} /><span>{storageError}</span><button onClick={() => setStorageError("")} aria-label="Dismiss"><X size={15} /></button></div>}

      {selectedDocument && activePage ? <div className="editor-view">
        <div className="editor-heading">
          <div className="editor-title-area">
            <button className="back-library" onClick={() => { setSelectedId(null); setMarkupMode("off"); setCropMode(false); }}><ArrowLeft size={16} /> Library</button>
            <input className="document-title-input" value={selectedDocument.title} onChange={(event) => updateDocument(selectedDocument.id, { title: event.target.value })} aria-label="Document title" />
            <span className="document-meta">{selectedDocument.pages.length} {selectedDocument.pages.length === 1 ? "page" : "pages"} · updated {formatDate(selectedDocument.updatedAt)}</span>
          </div>
          <div className="editor-actions">
            <button className="button button-quiet" onClick={() => beginScan(selectedDocument.id)}><Plus size={15} /> Add pages</button>
            <button className="button button-primary" onClick={() => void exportPdf("download")} disabled={exportBusy}><FileScan size={15} /> Export PDF</button>
            <button className="icon-button" onClick={() => void deleteSelectedDocument()} title="Delete scan"><Trash2 size={16} /></button>
          </div>
        </div>
        <div className="editor-workspace">
          <aside className="pages-rail">
            <div className="rail-heading"><span>PAGES <em>{selectedDocument.pages.length.toString().padStart(2, "0")}</em></span><button className="tiny-icon" onClick={() => beginScan(selectedDocument.id)} aria-label="Add a page"><Plus size={15} /></button></div>
            <div className="pages-list">
              {selectedDocument.pages.map((page, index) => <div className="page-row" key={page.id}>
                <PageThumbnail page={page} selected={page.id === activePage.id} compact onClick={() => { setSelectedPageId(page.id); setMarkupMode("off"); }} />
                <div className="page-row-label"><span>Page {String(index + 1).padStart(2, "0")}</span><small>{sizeLabel(page.image.size)}</small></div>
                <button className="page-menu" title="Select page" onClick={() => setSelectedPageId(page.id)}><MoreHorizontal size={16} /></button>
              </div>)}
            </div>
            <button className="add-page-button" onClick={() => beginScan(selectedDocument.id)}><ImagePlus size={16} /> Add page</button>
            <div className="page-order-actions">
              <button className="icon-button" title="Move page up" disabled={selectedDocument.pages[0]?.id === activePage.id} onClick={() => movePage(-1)}><ArrowUp size={15} /></button>
              <button className="icon-button" title="Move page down" disabled={selectedDocument.pages.at(-1)?.id === activePage.id} onClick={() => movePage(1)}><ArrowDown size={15} /></button>
              <button className="icon-button" title="Duplicate page" onClick={duplicatePage}><Copy size={15} /></button>
              <button className="icon-button" title="Rescan and replace page" onClick={() => beginScan(selectedDocument.id, activePage.id)}><RotateCw size={15} /></button>
              <button className="icon-button danger-icon" title="Delete page" onClick={deletePage}><Trash2 size={15} /></button>
            </div>
          </aside>

          <section className="page-work-area">
            <div className="canvas-toolbar">
              <div className="canvas-toolbar-left"><span className="toolbar-state"><span className="live-dot" /> {cropMode ? "Adjust page corners" : markupMode !== "off" ? `${markupMode === "redact" ? "Redaction" : markupMode === "signature" ? "Signature" : "Markup"} mode` : "Page preview"}</span>{saving && <span className="saving-label"><Check size={12} /> Saving</span>}</div>
              <div className="canvas-toolbar-right">
                <button className={`icon-button ${cropMode ? "tool-active" : ""}`} title="Adjust crop corners" onClick={() => { setCropMode((current) => !current); setMarkupMode("off"); }}><ScanLine size={16} /></button>
                <button className="icon-button" title="Rotate 90 degrees" onClick={() => updateActivePage({ rotation: (activePage.rotation + 90) % 360 })}><RotateCw size={16} /></button>
                <button className="icon-button" title="Undo last markup" disabled={!activePage.strokes.length} onClick={() => updateActivePage({ strokes: activePage.strokes.slice(0, -1) })}><ArrowLeft size={15} /></button>
              </div>
            </div>
            <div className={`page-canvas ${cropMode ? "crop-active" : ""} ${markupMode !== "off" && !cropMode ? "markup-active" : ""}`}>
              <div className="page-image-wrap">
                <img src={activePageUrl} alt={`Page preview of ${selectedDocument.title}`} className="page-preview-image" style={{ filter: filterPreview(activePage.filter), transform: `rotate(${activePage.rotation}deg)` }} />
                {cropMode && <CornerOverlay page={activePage} onChange={changeCorners} disabled={false} />}
                {!cropMode && (activePage.strokes.length > 0 || liveStroke) && <svg className="markup-preview" viewBox="0 0 100 100" preserveAspectRatio="none">{[...activePage.strokes, ...(liveStroke ? [liveStroke] : [])].map((stroke) => <polyline key={stroke.id} points={stroke.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")} fill="none" stroke={stroke.mode === "redact" ? "#080808" : stroke.mode === "signature" ? "#101010" : "#ed4035"} strokeWidth={stroke.width * 100} strokeLinecap="round" strokeLinejoin="round" />)}</svg>}
                {!cropMode && markupMode !== "off" && <svg className="markup-input" viewBox="0 0 100 100" preserveAspectRatio="none" onPointerDown={startMarkup} onPointerMove={continueMarkup} onPointerUp={endMarkup} onPointerCancel={endMarkup} aria-label="Draw markup on this page" />}
              </div>
            </div>
            <div className="canvas-caption"><span><span className="scan-status-dot" /> Autosaved locally</span><span>Page {selectedDocument.pages.findIndex((page) => page.id === activePage.id) + 1} of {selectedDocument.pages.length}</span></div>
            {cropMode && <div className="crop-tip"><ScanLine size={14} /> Drag the four red handles to fit the paper edge. Perspective correction is applied on export.<button onClick={() => { void detectDocumentCorners(activePage.image).then((corners) => updateActivePage({ corners })); }}>Auto-detect</button><button onClick={() => updateActivePage({ corners: DEFAULT_CORNERS })}>Reset</button></div>}
          </section>

          <aside className="tools-panel">
            <div className="tools-panel-head"><div><p className="eyebrow">PAGE TOOLS</p><h3>Refine scan</h3></div><Sparkles size={17} className="tools-spark" /></div>
            <div className="tool-section">
              <div className="section-title"><span>Enhancement</span><span className="subtle-label">ON DEVICE</span></div>
              <label className="select-wrap"><span className="visually-hidden">Scan filter</span><select value={activePage.filter} onChange={(event) => updateActivePage({ filter: event.target.value as FilterMode })}>
                <option value="original">Original color</option><option value="auto">Auto cleanup</option><option value="grayscale">Grayscale</option><option value="bw">Black &amp; white</option><option value="contrast">Boost contrast</option><option value="shadow">Reduce shadows</option>
              </select><ChevronDown size={15} /></label>
              <div className="preset-row"><button className={activePage.filter === "auto" ? "active" : ""} onClick={() => updateActivePage({ filter: "auto" })}>Auto</button><button className={activePage.filter === "grayscale" ? "active" : ""} onClick={() => updateActivePage({ filter: "grayscale" })}>Gray</button><button className={activePage.filter === "bw" ? "active" : ""} onClick={() => updateActivePage({ filter: "bw" })}>B&amp;W</button></div>
            </div>
            <div className="tool-section">
              <div className="section-title"><span>Markup</span><span className="subtle-label">FLATTENS ON EXPORT</span></div>
              <div className="markup-buttons">
                <button className={markupMode === "ink" ? "active" : ""} onClick={() => { setCropMode(false); setMarkupMode(markupMode === "ink" ? "off" : "ink"); }}><Pencil size={15} /> Draw</button>
                <button className={markupMode === "redact" ? "active" : ""} onClick={() => { setCropMode(false); setMarkupMode(markupMode === "redact" ? "off" : "redact"); }}><LockKeyhole size={15} /> Redact</button>
                <button className={markupMode === "signature" ? "active" : ""} onClick={() => { setCropMode(false); setMarkupMode(markupMode === "signature" ? "off" : "signature"); }}><Pencil size={15} /> Sign</button>
              </div>
              <p className="microcopy">{markupMode === "redact" ? "Drag over content to cover it. Marks are flattened in exported copies; the local original remains unchanged." : "Draw directly on the page. Your strokes are saved with this document."}</p>
            </div>
            <div className="tool-section ocr-section">
              <div className="section-title"><span>Searchable text</span><span className="subtle-label">TESSERACT · LOCAL</span></div>
              {selectedDocument.ocrText ? <div className="ocr-ready"><div className="ocr-ready-header"><span><Check size={13} /> Text found</span><button onClick={() => { void navigator.clipboard?.writeText(selectedDocument.ocrText).then(() => notify("Extracted text copied.")); }}>Copy</button></div><p>{selectedDocument.ocrText.slice(0, 230)}{selectedDocument.ocrText.length > 230 ? "…" : ""}</p></div> : <p className="microcopy">Extract words on this device, then search them from your library.</p>}
              <button className="button button-outline full-button" onClick={() => void handleOcr()} disabled={ocrBusy}>{ocrBusy ? <><LoaderCircle size={14} className="spin" /> Reading {ocrProgress}%</> : <><ScanLine size={14} /> {selectedDocument.ocrText ? "Run OCR again" : "Extract text"}</>}</button>
            </div>
            <div className="tool-section organize-section">
              <div className="section-title"><span>Organize</span></div>
              <label className="field-label small-label" htmlFor="folder-name">Folder</label>
              <div className="compact-field"><input id="folder-name" value={folderEditing ? folderInput : selectedDocument.folder} onFocus={() => { setFolderInput(selectedDocument.folder); setFolderEditing(true); }} onChange={(event) => setFolderInput(event.target.value)} onBlur={addFolder} onKeyDown={(event) => { if (event.key === "Enter") addFolder(); }} /><Folder size={14} /></div>
              <label className="field-label small-label" htmlFor="tags-name">Tags <span>(comma separated)</span></label>
              <div className="compact-field"><input id="tags-name" placeholder={selectedDocument.tags.join(", ") || "receipt, travel…"} value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addTags(); }} /><Tag size={14} /></div>
              {selectedDocument.tags.length > 0 && <div className="tag-list">{selectedDocument.tags.map((tag) => <button key={tag} className="tag-pill" onClick={() => updateDocument(selectedDocument.id, { tags: selectedDocument.tags.filter((item) => item !== tag) })}>{tag}<X size={11} /></button>)}</div>}
            </div>
          </aside>
        </div>
        <footer className="export-dock">
          <div className="quality-control"><span>Export quality</span><input type="range" min="55" max="95" step="5" value={Math.round(quality * 100)} onChange={(event) => setQuality(Number(event.target.value) / 100)} /><strong>{Math.round(quality * 100)}%</strong></div>
          <div className="export-actions">
            <button className="button button-quiet" onClick={() => void exportImages()} disabled={exportBusy}><FileImage size={15} /> Images</button>
            <button className="button button-quiet" onClick={() => void exportPdf("print")} disabled={exportBusy}><Printer size={15} /> Print</button>
            <button className="button button-quiet" onClick={() => void exportPdf("share")} disabled={exportBusy}><Share2 size={15} /> Share</button>
            <button className="button button-quiet" onClick={() => void protectPdf()} disabled={exportBusy}><FileLock2 size={15} /> Encrypt copy</button>
            <button className="button button-quiet" onClick={openUnlockPicker}><UnlockKeyhole size={15} /> Unlock file</button>
          </div>
        </footer>
        {progressNote && <div className="progress-ribbon"><LoaderCircle size={14} className="spin" /> {progressNote}</div>}
      </div> : <>
        <div className="library-content">
          <div className="library-heading-row">
            <div><p className="eyebrow">YOUR PERSONAL SCAN DESK</p><h1>Your documents,<br className="mobile-break" /> without the paper.</h1><p className="library-intro">Scan it once. Find it when you need it. Everything stays on this device.</p></div>
            <button className="button button-primary large-scan" onClick={() => beginScan()}><ScanLine size={17} /> Scan a document <ArrowRight size={15} /></button>
          </div>
          <div className="stat-strip">
            <div className="stat-cell"><span>IN YOUR LIBRARY</span><strong>{String(documents.length).padStart(2, "0")}</strong><small>documents</small></div>
            <div className="stat-cell"><span>PAGES CAPTURED</span><strong>{String(totalPages).padStart(2, "0")}</strong><small>across all scans</small></div>
            <div className="stat-cell"><span>ON THIS DEVICE</span><strong>{sizeLabel(storageUsed)}</strong><small>private local storage</small></div>
            <div className="privacy-stat"><ShieldCheck size={17} /><div><strong>Local by design</strong><small>No account. No cloud upload.</small></div></div>
          </div>
          <section className="library-section">
            <div className="library-section-header"><div><h2>All scans <span>{documents.length}</span></h2><p>Private, searchable, and saved as you work.</p></div><button className="button button-quiet import-library" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> Import images</button></div>
            <div className="library-controls">
              <label className="search-field"><Search size={16} /><input aria-label="Search scans" placeholder="Search titles, tags, or recognized text…" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
              <label className="folder-select"><Folder size={15} /><select value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}>{folders.map((folder) => <option key={folder}>{folder}</option>)}</select><ChevronDown size={14} /></label>
              <label className="sort-select"><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="recent">Most recent</option><option value="title">Name</option><option value="pages">Page count</option></select><ChevronDown size={14} /></label>
              <div className="view-toggle"><button className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} aria-label="Grid view"><span className="grid-glyph" /></button><button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} aria-label="List view"><span className="list-glyph" /></button></div>
            </div>
            {filteredDocuments.length === 0 ? <div className="empty-library">
              <div className="empty-stack"><div className="empty-paper paper-back" /><div className="empty-paper paper-middle" /><div className="empty-paper paper-front"><ScanLine size={27} /></div><span className="empty-spark spark-one" /><span className="empty-spark spark-two" /></div>
              <p className="eyebrow">A CLEAN SLATE</p><h3>{documents.length === 0 ? "Your first scan starts here." : "Nothing in this corner yet."}</h3><p>{documents.length === 0 ? "Point your camera at a page. We'll find the edges, clean it up, and keep it here." : "Try another search, choose a different folder, or import an image."}</p>
              <div className="empty-actions"><button className="button button-primary" onClick={() => beginScan()}><ScanLine size={16} /> Start your first scan</button><button className="button button-quiet" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> Import an image</button></div>
            </div> : <div className={`document-list ${viewMode === "list" ? "list-view" : "grid-view"}`}>
              {filteredDocuments.map((document) => <DocumentCard key={document.id} document={document} onClick={() => { setSelectedId(document.id); setSelectedPageId(document.pages[0]?.id ?? ""); setMarkupMode("off"); }} />)}
            </div>}
          </section>
          <div className="privacy-footer"><ShieldCheck size={15} /><span>Paperless does not upload your scans. Local storage can be cleared by your browser, so export important documents as backups.</span><button onClick={() => void addInstall()}>Install for offline use <ArrowRight size={13} /></button></div>
        </div>
      </>}
    </section>

    {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    {scannerOpen && <CameraSheet pageCount={draftPages.length} busy={scanBusy} onPage={onCapturedPage} onFinish={() => void finishScan()} onClose={() => { setScannerOpen(false); setDraftPages([]); setScanTargetId(null); setScanReplacePageId(null); }} />}
    {showSetup && <NameSetup initialName={workspaceName} onSave={saveWorkspaceName} />}
    {toast && <div className="toast-message"><Check size={15} />{toast}</div>}
    {exportBusy && <div className="busy-overlay"><LoaderCircle className="spin" size={18} />{progressNote || "Working locally…"}</div>}
  </main>;
}

function DocumentCard({ document, onClick }: { document: ScanDocument; onClick: () => void }) {
  const first = document.pages[0];
  const url = useObjectUrl(first?.image);
  const second = useObjectUrl(document.pages[1]?.image);
  return <button className="document-card" onClick={onClick}>
    <div className="document-card-preview">
      {url ? <img src={url} alt="" style={{ filter: filterPreview(first.filter) }} /> : <div className="document-placeholder"><FileScan size={24} /></div>}
      {document.pages.length > 1 && second && <div className="preview-stack"><img src={second} alt="" /></div>}
      <span className="page-count-badge">{document.pages.length} <Files size={11} /></span>
      <span className="card-open"><ArrowRight size={15} /></span>
    </div>
    <div className="document-card-info"><div className="card-title-row"><h3>{document.title || "Untitled scan"}</h3><MoreHorizontal size={16} /></div><p><span>{document.folder || "Inbox"}</span><i />{formatDate(document.updatedAt)}</p>
      {document.tags.length > 0 && <div className="card-tags">{document.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}{document.tags.length > 2 && <small>+{document.tags.length - 2}</small>}</div>}
      {document.ocrText && <div className="ocr-indexed"><ScanLine size={12} /> Searchable text</div>}
    </div>
  </button>;
}
