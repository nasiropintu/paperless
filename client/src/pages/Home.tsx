import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Capacitor } from "@capacitor/core";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpenText, Check, ChevronDown, CircleHelp,
  CloudOff, Copy, Download, FileImage, FileLock2, FilePlus2, FileScan, Files,
  Folder, Heart, ImagePlus, LoaderCircle, LockKeyhole, Menu, MoreHorizontal, MoreVertical, Pencil,
  Plus, Printer, RotateCw, ScanLine, Search, Share2, ShieldCheck, Sparkles, Tag, Trash2,
  UnlockKeyhole, Upload, X, Zap, Sliders, Layers
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
  return (
    <button className={`page-thumb ${selected ? "is-selected" : ""} ${compact ? "is-compact" : ""}`} onClick={onClick} title="Open page">
      {url ? (
        <img
          src={url}
          alt="Scanned page preview"
          style={{
            filter: page.filter === "grayscale" ? "grayscale(1)" : page.filter === "bw" ? "grayscale(1) contrast(2.1)" : page.filter === "contrast" ? "contrast(1.4)" : page.filter === "shadow" ? "brightness(1.08)" : undefined,
            transform: `rotate(${page.rotation}deg)`
          }}
        />
      ) : (
        <span className="thumb-placeholder" />
      )}
    </button>
  );
}

function scanPage(image: Blob): Promise<ScanPage> {
  return detectDocumentCorners(image).then((corners) => ({
    id: makeId(),
    image,
    corners,
    rotation: 0,
    filter: "original",
    strokes: [],
    createdAt: Date.now(),
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
  if (mode === "sharpen") return "contrast(1.2) brightness(1.02)";
  if (mode === "whiteboard") return "brightness(1.15) contrast(1.25)";
  return "none";
}

function HeaderMark({ small = false }: { small?: boolean }) {
  return <span className={`header-mark ${small ? "small" : ""}`} aria-hidden="true"><FileScan size={small ? 17 : 19} strokeWidth={2.2} /></span>;
}

/**
 * Enhanced Corner Overlay with Magnifying Loupe for precision phone cropping
 */
function CornerOverlay({
  page,
  imageUrl,
  onChange,
  disabled,
}: {
  page: ScanPage;
  imageUrl?: string;
  onChange: (corners: [Point, Point, Point, Point]) => void;
  disabled: boolean;
}) {
  const [activeCorner, setActiveCorner] = useState<number | null>(null);
  const [touchPos, setTouchPos] = useState<{ x: number; y: number } | null>(null);

  const updateCorner = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled || activeCorner === null) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0.01, Math.min(0.99, (e.clientX - bounds.left) / bounds.width));
    const y = Math.max(0.01, Math.min(0.99, (e.clientY - bounds.top) / bounds.height));

    setTouchPos({ x: e.clientX, y: e.clientY });

    const next = [...page.corners] as [Point, Point, Point, Point];
    next[activeCorner] = { x, y };
    onChange(next);
  };

  const handlePointerUp = () => {
    setActiveCorner(null);
    setTouchPos(null);
  };

  const points = page.corners.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");

  return (
    <>
      <svg
        className={`corner-overlay ${disabled ? "" : "can-adjust"}`}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onPointerMove={updateCorner}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <polygon points={points} className="crop-polygon" />
        {page.corners.map((point, index) => (
          <circle
            key={index}
            cx={point.x * 100}
            cy={point.y * 100}
            r="3.2"
            className={`crop-handle ${activeCorner === index ? "crop-handle-active" : ""}`}
            onPointerDown={(e) => {
              if (disabled) return;
              setActiveCorner(index);
              setTouchPos({ x: e.clientX, y: e.clientY });
              e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
            }}
          />
        ))}
      </svg>

      {/* Floating Loupe Magnifier above user finger */}
      {activeCorner !== null && touchPos && imageUrl && (
        <div
          className="corner-magnifier-loupe"
          style={{
            left: `${touchPos.x}px`,
            top: `${Math.max(20, touchPos.y - 100)}px`,
          }}
        >
          <div
            className="loupe-image-viewport"
            style={{
              backgroundImage: `url(${imageUrl})`,
              backgroundPosition: `${page.corners[activeCorner].x * 100}% ${page.corners[activeCorner].y * 100}%`,
              backgroundSize: "600%",
            }}
          >
            <div className="loupe-crosshair" />
          </div>
        </div>
      )}
    </>
  );
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
  const [activeEditorTab, setActiveEditorTab] = useState<"filters" | "crop" | "markup" | "ocr" | "organize">("filters");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const [quality, setQuality] = useState(0.88);
  const [online, setOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [toast, setToast] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
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

  // Distinct file inputs to ensure 100% Android compatibility
  const imageInputRef = useRef<HTMLInputElement>(null);
  const encryptedInputRef = useRef<HTMLInputElement>(null);
  const activeStrokeRef = useRef<Stroke | null>(null);

  const selectedDocument = documents.find((doc) => doc.id === selectedId) ?? null;
  const activePage = selectedDocument?.pages.find((p) => p.id === selectedPageId) ?? selectedDocument?.pages[0] ?? null;
  const activePageUrl = useObjectUrl(activePage?.image);
  const totalPages = documents.reduce((sum, doc) => sum + doc.pages.length, 0);
  const storageUsed = documents.reduce((sum, doc) => sum + doc.pages.reduce((pSum, p) => pSum + p.image.size, 0), 0);
  const folders = useMemo(() => ["All folders", ...Array.from(new Set(["Inbox", ...customFolders, ...documents.map((d) => d.folder).filter(Boolean)])).sort((a, b) => a.localeCompare(b))], [documents, customFolders]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
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
    if (selectedDocument && selectedPageId && !selectedDocument.pages.some((p) => p.id === selectedPageId)) setSelectedPageId(selectedDocument.pages[0]?.id ?? "");
  }, [selectedDocument, selectedPageId]);

  const persistDocument = async (document: ScanDocument) => {
    setSaving(true);
    try {
      await saveDocument({ ...document, updatedAt: Date.now() });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to save to local storage.");
    } finally {
      setSaving(false);
    }
  };

  const updateDocument = (id: string, update: Partial<ScanDocument> | ((doc: ScanDocument) => ScanDocument)) => {
    setDocuments((previous) => previous.map((doc) => {
      if (doc.id !== id) return doc;
      const next = typeof update === "function" ? update(doc) : { ...doc, ...update, updatedAt: Date.now() };
      void persistDocument(next);
      return next;
    }));
  };

  const beginScan = async (targetDocumentId?: string, replacePageId?: string) => {
    // 1. Android Native App: Launch Google ML Kit Document Scanner
    if (Capacitor.isNativePlatform()) {
      try {
        const { DocumentScanner } = await import("@capacitor-mlkit/document-scanner");
        const result = await DocumentScanner.scanDocument({
          galleryImportAllowed: true,
          pageLimit: 30,
          resultFormats: "JPEG_PDF",
          scannerMode: "FULL",
        });

        if (result.scannedImages && result.scannedImages.length > 0) {
          setScanBusy(true);
          setProgressNote("Importing scanned pages…");
          const importedPages: ScanPage[] = [];
          for (const uri of result.scannedImages) {
            const res = await fetch(Capacitor.convertFileSrc(uri));
            const blob = await res.blob();
            // Google ML Kit has already auto-straightened, cropped, and enhanced the page
            importedPages.push({
              id: makeId(),
              image: blob,
              corners: DEFAULT_CORNERS,
              rotation: 0,
              filter: "original",
              strokes: [],
              createdAt: Date.now(),
            });
          }

          const now = Date.now();
          if (targetDocumentId) {
            if (replacePageId) {
              updateDocument(targetDocumentId, (doc) => ({
                ...doc,
                pages: doc.pages.map((p) => (p.id === replacePageId ? importedPages[0] : p)),
                ocrText: "",
              }));
              setSelectedPageId(importedPages[0].id);
              notify("Page replaced.");
            } else {
              updateDocument(targetDocumentId, (doc) => ({
                ...doc,
                pages: [...doc.pages, ...importedPages],
                ocrText: "",
              }));
              setSelectedPageId(importedPages[0].id);
              notify(`${importedPages.length} page${importedPages.length === 1 ? "" : "s"} added.`);
            }
          } else {
            const newDoc: ScanDocument = {
              id: makeId(),
              title: `Scan — ${formatDate(now)}`,
              folder: folderFilter !== "All folders" ? folderFilter : "Inbox",
              tags: [],
              pages: importedPages,
              ocrText: "",
              createdAt: now,
              updatedAt: now,
            };
            setDocuments((prev) => [newDoc, ...prev]);
            await persistDocument(newDoc);
            setSelectedId(newDoc.id);
            setSelectedPageId(importedPages[0].id);
            notify(`New scan created with ${importedPages.length} page${importedPages.length === 1 ? "" : "s"}.`);
          }
          return;
        }
      } catch (err: any) {
        if (err?.message?.toLowerCase().includes("cancel")) return;
        console.warn("ML Kit Document Scanner fallback:", err);
      } finally {
        setScanBusy(false);
        setProgressNote("");
      }
    }

    // 2. Web / PWA fallback: Open CameraSheet
    setScanTargetId(targetDocumentId ?? null);
    setScanReplacePageId(replacePageId ?? null);
    setDraftPages([]);
    setScannerOpen(true);
  };

  const onCapturedPage = async (image: Blob) => {
    setScanBusy(true);
    setProgressNote("Auto-straightening page…");
    try {
      const page = await scanPage(image);
      setDraftPages((current) => [...current, page]);
    } catch {
      notify("Could not process this capture.");
    } finally {
      setProgressNote("");
      setScanBusy(false);
    }
  };

  const finishScan = async () => {
    if (draftPages.length === 0) return;
    setScannerOpen(false);
    const now = Date.now();

    if (scanTargetId) {
      if (scanReplacePageId) {
        updateDocument(scanTargetId, (doc) => ({
          ...doc,
          pages: doc.pages.map((p) => (p.id === scanReplacePageId ? draftPages[0] : p)),
          ocrText: "",
        }));
        setSelectedPageId(draftPages[0].id);
        notify("Page replaced.");
      } else {
        updateDocument(scanTargetId, (doc) => ({
          ...doc,
          pages: [...doc.pages, ...draftPages],
          ocrText: "",
        }));
        setSelectedPageId(draftPages[0].id);
        notify(`${draftPages.length} page${draftPages.length === 1 ? "" : "s"} added.`);
      }
    } else {
      const newDoc: ScanDocument = {
        id: makeId(),
        title: `Scan — ${formatDate(now)}`,
        folder: folderFilter !== "All folders" ? folderFilter : "Inbox",
        tags: [],
        pages: draftPages,
        ocrText: "",
        createdAt: now,
        updatedAt: now,
      };
      setDocuments((prev) => [newDoc, ...prev]);
      await persistDocument(newDoc);
      setSelectedId(newDoc.id);
      setSelectedPageId(draftPages[0].id);
      notify(`New scan created with ${draftPages.length} page${draftPages.length === 1 ? "" : "s"}.`);
    }

    setDraftPages([]);
    setScanTargetId(null);
    setScanReplacePageId(null);
  };

  // Pure Android-compatible photo import
  const handleImport = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const images = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;

    setScanBusy(true);
    setProgressNote("Importing selected images…");
    const imported: ScanPage[] = [];
    try {
      for (const img of images) {
        imported.push(await scanPage(img));
      }
      const now = Date.now();
      const newDoc: ScanDocument = {
        id: makeId(),
        title: images.length === 1 ? images[0].name.replace(/\.[^.]+$/, "") || "Imported scan" : `Import — ${formatDate(now)}`,
        folder: "Inbox",
        tags: [],
        pages: imported,
        ocrText: "",
        createdAt: now,
        updatedAt: now,
      };
      setDocuments((prev) => [newDoc, ...prev]);
      await persistDocument(newDoc);
      setSelectedId(newDoc.id);
      setSelectedPageId(imported[0]?.id ?? "");
      notify(`${imported.length} image${imported.length === 1 ? "" : "s"} imported.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to import images.");
    } finally {
      setProgressNote("");
      setScanBusy(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const handleUnlockFile = async (file: File | undefined) => {
    if (!file) return;
    const password = window.prompt("Enter the password for this encrypted scan.");
    if (!password) return;
    try {
      const pdf = await unlockPdf(file, password);
      downloadBlob(pdf, file.name.replace(/\.paperless$/i, ".pdf"));
      notify("Document unlocked and downloaded.");
    } catch {
      notify("Incorrect password or corrupt file.");
    }
    if (encryptedInputRef.current) encryptedInputRef.current.value = "";
  };

  const filteredDocuments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((doc) => {
      const folderMatch = folderFilter === "All folders" || doc.folder === folderFilter;
      const text = `${doc.title} ${doc.folder} ${doc.tags.join(" ")} ${doc.ocrText}`.toLowerCase();
      return folderMatch && (!q || text.includes(q));
    }).sort((a, b) => (sortBy === "title" ? a.title.localeCompare(b.title) : sortBy === "pages" ? b.pages.length - a.pages.length : b.updatedAt - a.updatedAt));
  }, [documents, search, folderFilter, sortBy]);

  const updateActivePage = (change: Partial<ScanPage> | ((page: ScanPage) => ScanPage)) => {
    if (!selectedDocument || !activePage) return;
    updateDocument(selectedDocument.id, (doc) => ({
      ...doc,
      pages: doc.pages.map((p) => {
        if (p.id !== activePage.id) return p;
        return typeof change === "function" ? change(p) : { ...p, ...change };
      }),
    }));
  };

  const deleteSelectedDocument = async () => {
    if (!selectedDocument) return;
    if (!window.confirm(`Delete “${selectedDocument.title}”? This cannot be undone.`)) return;
    setDocuments((prev) => prev.filter((d) => d.id !== selectedDocument.id));
    try {
      await removeStoredDocument(selectedDocument.id);
    } catch {
      notify("Could not remove from local storage.");
    }
    setSelectedId(null);
    setSelectedPageId("");
    notify("Scan deleted.");
  };

  const deletePage = () => {
    if (!selectedDocument || !activePage) return;
    if (selectedDocument.pages.length === 1) {
      void deleteSelectedDocument();
      return;
    }
    if (!window.confirm("Delete this page?")) return;
    const idx = selectedDocument.pages.findIndex((p) => p.id === activePage.id);
    const remaining = selectedDocument.pages.filter((p) => p.id !== activePage.id);
    updateDocument(selectedDocument.id, { pages: remaining, ocrText: "" });
    setSelectedPageId(remaining[Math.max(0, idx - 1)].id);
  };

  const exportPdf = async (action: "download" | "share" | "print" = "download") => {
    if (!selectedDocument) return;
    setExportBusy(true);
    setProgressNote("Generating PDF locally…");
    try {
      const pdf = await createPdf(selectedDocument, quality);
      const filename = `${selectedDocument.title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "Paperless-scan"}.pdf`;
      if (action === "share") {
        const res = await shareOrDownload(pdf, filename, selectedDocument.title);
        notify(res === "shared" ? "PDF shared." : "PDF downloaded.");
      } else {
        downloadBlob(pdf, filename);
        notify("PDF downloaded.");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExportBusy(false);
      setProgressNote("");
    }
  };

  const handleOcr = async () => {
    if (!selectedDocument) return;
    setOcrBusy(true);
    setOcrProgress(0);
    setProgressNote("Extracting text locally…");
    try {
      const { recognizePages } = await import("@/lib/ocrEngine");
      const blobs = selectedDocument.pages.map((p) => p.image);
      const result = await recognizePages(blobs, (progress) => {
        setOcrProgress(progress.percent);
        setProgressNote(progress.message);
      });
      updateDocument(selectedDocument.id, { ocrText: result.text });
      const engineLabel = result.engine === "mlkit" ? "ML Kit" : "Tesseract";
      notify(`Text extracted (${engineLabel}) and saved with scan.`);
    } catch (error) {
      notify(error instanceof Error ? `OCR failed: ${error.message}` : "OCR could not run.");
    } finally {
      setOcrBusy(false);
      setProgressNote("");
    }
  };

  const startMarkup = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!activePage || markupMode === "off" || cropMode) return;
    const b = e.currentTarget.getBoundingClientRect();
    const pt = { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
    activeStrokeRef.current = {
      id: makeId(),
      mode: markupMode,
      points: [pt],
      width: markupMode === "redact" ? 0.045 : markupMode === "signature" ? 0.012 : 0.008,
    };
    setLiveStroke(activeStrokeRef.current);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const continueMarkup = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!activeStrokeRef.current || !activePage) return;
    const b = e.currentTarget.getBoundingClientRect();
    const pt = { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
    activeStrokeRef.current = {
      ...activeStrokeRef.current,
      points: [...activeStrokeRef.current.points, pt],
    };
    setLiveStroke(activeStrokeRef.current);
  };

  const endMarkup = () => {
    if (!activeStrokeRef.current || !activePage) return;
    const stroke = activeStrokeRef.current;
    activeStrokeRef.current = null;
    setLiveStroke(null);
    updateActivePage({ strokes: [...activePage.strokes, stroke] });
  };

  return (
    <main className="app-shell">
      {/* Hidden file pickers with clean MIME types */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void handleImport(e.target.files)}
      />
      <input
        ref={encryptedInputRef}
        type="file"
        accept=".paperless,application/vnd.paperless.encrypted,application/octet-stream"
        hidden
        onChange={(e) => void handleUnlockFile(e.target.files?.[0])}
      />

      {/* Desktop / Tablet Sidebar */}
      <aside className={`sidebar ${mobileSidebarOpen ? "sidebar-mobile-open" : ""}`}>
        <div className="side-brand">
          <HeaderMark />
          <div className="brand-name-block">
            <button className="brand-name" onClick={() => setRenameInput(true)}>
              {workspaceName}
            </button>
            <span className="brand-edition">LOCAL SCAN DESK</span>
          </div>
          <button
            className="mobile-close-btn"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="side-nav">
          <p className="nav-label">WORKSPACE</p>
          <button
            className={`nav-item ${!selectedId && folderFilter === "All folders" ? "active" : ""}`}
            onClick={() => { setSelectedId(null); setFolderFilter("All folders"); setMobileSidebarOpen(false); }}
          >
            <Files size={16} />
            <span>All Documents</span>
            <span className="nav-count">{documents.length}</span>
          </button>

          <p className="nav-label folder-label">
            <span>FOLDERS</span>
            <button
              className="tiny-icon"
              title="New folder"
              onClick={() => {
                const f = window.prompt("Folder name:");
                if (f?.trim()) {
                  const next = Array.from(new Set([...customFolders, f.trim()]));
                  setCustomFolders(next);
                  localStorage.setItem("paperless.custom-folders", JSON.stringify(next));
                }
              }}
            >
              <Plus size={14} />
            </button>
          </p>

          {folders.map((folder) => (
            <button
              key={folder}
              className={`nav-item ${folderFilter === folder && !selectedId ? "active" : ""}`}
              onClick={() => { setFolderFilter(folder); setSelectedId(null); setMobileSidebarOpen(false); }}
            >
              <Folder size={15} />
              <span className="nav-truncate">{folder}</span>
              <span className="nav-count">{documents.filter((d) => folder === "All folders" || d.folder === folder).length}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="storage-meter">
            <div className="storage-copy">
              <span>Local Storage</span>
              <span>{sizeLabel(storageUsed)}</span>
            </div>
            <div className="storage-track">
              <span style={{ width: `${Math.min(100, Math.max(8, (storageUsed / (50 * 1024 * 1024)) * 100))}%` }} />
            </div>
          </div>

          <button className="creator-sidebar-pill" onClick={() => setAboutOpen(true)}>
            <div className="creator-pill-heart">
              <Heart size={15} style={{ fill: "currentColor" }} />
            </div>
            <div className="creator-pill-text">
              Crafted with ❤️ by <strong>NasirPintu</strong>
              <div className="text-[10px] opacity-75">Paperless v1.2.0 · Local Desk</div>
            </div>
          </button>

          <button className="side-help" onClick={() => setAboutOpen(true)}>
            <CircleHelp size={15} /> About &amp; AI Credits
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="main-panel">
        {/* Mobile Header Bar */}
        <header className="mobile-appbar">
          <button
            className="icon-btn-ghost"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu size={21} />
          </button>
          <div className="mobile-appbar-title">
            <HeaderMark small />
            <span className="truncate font-semibold">{selectedDocument ? selectedDocument.title : workspaceName}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="icon-btn-ghost"
              onClick={() => setAboutOpen(true)}
              title="About & AI Credits"
            >
              <Heart size={19} className="text-[#ff6b6b]" style={{ fill: "currentColor" }} />
            </button>
            <button
              className="icon-btn-ghost"
              onClick={() => imageInputRef.current?.click()}
              title="Import image"
            >
              <FileImage size={20} />
            </button>
          </div>
        </header>

        {/* Selected Document Editor */}
        {selectedDocument && activePage ? (
          <div className="editor-view mobile-editor-layout">
            {/* Editor Top Navigation Bar */}
            <div className="editor-top-nav">
              <button
                className="btn-back-pill"
                onClick={() => { setSelectedId(null); setCropMode(false); setMarkupMode("off"); }}
              >
                <ArrowLeft size={16} /> Library
              </button>
              <input
                className="editor-title-field"
                value={selectedDocument.title}
                onChange={(e) => updateDocument(selectedDocument.id, { title: e.target.value })}
              />
              <button
                className="button button-primary btn-export-top"
                onClick={() => void exportPdf("share")}
                disabled={exportBusy}
              >
                <Share2 size={15} /> Export
              </button>
            </div>

            {/* Document Canvas Workspace */}
            <div className="editor-preview-stage">
              <div className={`page-canvas ${cropMode ? "crop-active" : ""}`}>
                <div className="page-image-wrap">
                  <img
                    src={activePageUrl}
                    alt="Page preview"
                    className="page-preview-image"
                    style={{
                      filter: filterPreview(activePage.filter),
                      transform: `rotate(${activePage.rotation}deg)`,
                    }}
                  />

                  {/* High-Precision Crop Overlay with Loupe */}
                  {cropMode && (
                    <CornerOverlay
                      page={activePage}
                      imageUrl={activePageUrl}
                      onChange={(corners) => updateActivePage({ corners })}
                      disabled={false}
                    />
                  )}

                  {/* Markup Overlay */}
                  {!cropMode && (activePage.strokes.length > 0 || liveStroke) && (
                    <svg className="markup-preview" viewBox="0 0 100 100" preserveAspectRatio="none">
                      {[...activePage.strokes, ...(liveStroke ? [liveStroke] : [])].map((s) => (
                        <polyline
                          key={s.id}
                          points={s.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
                          fill="none"
                          stroke={s.mode === "redact" ? "#080808" : s.mode === "signature" ? "#111111" : "#ed4035"}
                          strokeWidth={s.width * 100}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ))}
                    </svg>
                  )}

                  {!cropMode && markupMode !== "off" && (
                    <svg
                      className="markup-input"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      onPointerDown={startMarkup}
                      onPointerMove={continueMarkup}
                      onPointerUp={endMarkup}
                      onPointerCancel={endMarkup}
                    />
                  )}
                </div>
              </div>

              {/* Page Strip Carousel */}
              <div className="mobile-pages-carousel">
                {selectedDocument.pages.map((p, idx) => (
                  <button
                    key={p.id}
                    className={`carousel-thumb ${p.id === activePage.id ? "thumb-active" : ""}`}
                    onClick={() => { setSelectedPageId(p.id); setCropMode(false); }}
                  >
                    <PageThumbnail page={p} selected={p.id === activePage.id} compact onClick={() => {}} />
                    <span>{idx + 1}</span>
                  </button>
                ))}
                <button
                  className="carousel-add-btn"
                  onClick={() => beginScan(selectedDocument.id)}
                  title="Add page"
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>

            {/* Bottom Tool Panels (Adobe Scan Style) */}
            <div className="editor-bottom-tools-dock">
              {/* Tab Selector Buttons */}
              <div className="tools-tab-bar">
                <button
                  className={`tool-tab-btn ${activeEditorTab === "crop" || cropMode ? "tab-active" : ""}`}
                  onClick={() => {
                    const next = !cropMode;
                    setCropMode(next);
                    setMarkupMode("off");
                    setActiveEditorTab("crop");
                  }}
                >
                  <ScanLine size={18} />
                  <span>Crop</span>
                </button>

                <button
                  className={`tool-tab-btn ${activeEditorTab === "filters" && !cropMode ? "tab-active" : ""}`}
                  onClick={() => { setCropMode(false); setActiveEditorTab("filters"); }}
                >
                  <Sliders size={18} />
                  <span>Filters</span>
                </button>

                <button
                  className="tool-tab-btn"
                  onClick={() => updateActivePage({ rotation: (activePage.rotation + 90) % 360 })}
                >
                  <RotateCw size={18} />
                  <span>Rotate</span>
                </button>

                <button
                  className={`tool-tab-btn ${activeEditorTab === "markup" ? "tab-active" : ""}`}
                  onClick={() => {
                    setCropMode(false);
                    setActiveEditorTab("markup");
                    setMarkupMode("ink");
                  }}
                >
                  <Pencil size={18} />
                  <span>Draw</span>
                </button>

                <button
                  className={`tool-tab-btn ${activeEditorTab === "ocr" ? "tab-active" : ""}`}
                  onClick={() => { setCropMode(false); setActiveEditorTab("ocr"); }}
                >
                  <BookOpenText size={18} />
                  <span>OCR</span>
                </button>

                <button
                  className="tool-tab-btn text-red-400 hover:text-red-300"
                  onClick={deletePage}
                  title="Delete page"
                >
                  <Trash2 size={18} />
                  <span>Delete</span>
                </button>
              </div>

              {/* Sub-Panel Controls based on active tab */}
              <div className="tool-subpanel">
                {cropMode && (
                  <div className="crop-controls-strip">
                    <span>Drag corners to straighten</span>
                    <button
                      className="pill-btn-action"
                      onClick={() => void detectDocumentCorners(activePage.image).then((corners) => updateActivePage({ corners }))}
                    >
                      <Sparkles size={14} /> Auto-Detect
                    </button>
                    <button
                      className="pill-btn-ghost"
                      onClick={() => updateActivePage({ corners: DEFAULT_CORNERS })}
                    >
                      Reset
                    </button>
                    <button
                      className="pill-btn-done"
                      onClick={() => setCropMode(false)}
                    >
                      Done
                    </button>
                  </div>
                )}

                {activeEditorTab === "filters" && !cropMode && (
                  <div className="filter-chips-row">
                    {(["auto", "bw", "whiteboard", "sharpen", "grayscale", "contrast", "original"] as FilterMode[]).map((mode) => (
                      <button
                        key={mode}
                        className={`filter-chip ${activePage.filter === mode ? "chip-active" : ""}`}
                        onClick={() => updateActivePage({ filter: mode })}
                      >
                        {mode === "auto" ? "Magic Auto" : mode === "bw" ? "Clean B&W" : mode === "whiteboard" ? "Whiteboard" : mode === "sharpen" ? "Sharpen" : mode === "grayscale" ? "Grayscale" : mode === "contrast" ? "High Contrast" : "Original"}
                      </button>
                    ))}
                  </div>
                )}

                {activeEditorTab === "markup" && !cropMode && (
                  <div className="markup-tools-strip">
                    <button
                      className={`markup-mode-pill ${markupMode === "ink" ? "pill-active" : ""}`}
                      onClick={() => setMarkupMode("ink")}
                    >
                      Pen
                    </button>
                    <button
                      className={`markup-mode-pill ${markupMode === "redact" ? "pill-active" : ""}`}
                      onClick={() => setMarkupMode("redact")}
                    >
                      Redact
                    </button>
                    <button
                      className={`markup-mode-pill ${markupMode === "signature" ? "pill-active" : ""}`}
                      onClick={() => setMarkupMode("signature")}
                    >
                      Signature
                    </button>
                    {activePage.strokes.length > 0 && (
                      <button
                        className="pill-btn-ghost"
                        onClick={() => updateActivePage({ strokes: activePage.strokes.slice(0, -1) })}
                      >
                        Undo
                      </button>
                    )}
                  </div>
                )}

                {activeEditorTab === "ocr" && !cropMode && (
                  <div className="ocr-quick-strip">
                    {selectedDocument.ocrText ? (
                      <div className="ocr-text-preview">
                        <p>{selectedDocument.ocrText.slice(0, 140)}…</p>
                        <button
                          className="pill-btn-action"
                          onClick={() => {
                            void navigator.clipboard?.writeText(selectedDocument.ocrText).then(() => notify("Text copied!"));
                          }}
                        >
                          Copy
                        </button>
                      </div>
                    ) : (
                      <button
                        className="pill-btn-action"
                        onClick={() => void handleOcr()}
                        disabled={ocrBusy}
                      >
                        {ocrBusy ? <LoaderCircle className="spin" size={14} /> : <ScanLine size={14} />}
                        <span>{ocrBusy ? `Reading ${ocrProgress}%` : "Extract Text (OCR)"}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Document Library Screen */
          <div className="library-content mobile-library-layout">
            {/* Search and Filters */}
            <div className="library-search-strip">
              <div className="search-pill-wrapper">
                <Search size={18} className="search-icon" />
                <input
                  aria-label="Search scans"
                  placeholder="Search scans, folders, OCR text…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button onClick={() => setSearch("")} className="clear-search-btn">
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>

            {/* Folder Filter Chips */}
            <div className="folder-chips-scroll">
              {folders.map((f) => (
                <button
                  key={f}
                  className={`folder-chip ${folderFilter === f ? "chip-active" : ""}`}
                  onClick={() => setFolderFilter(f)}
                >
                  <Folder size={13} />
                  <span>{f}</span>
                </button>
              ))}
            </div>

            {/* Document Grid / List */}
            {filteredDocuments.length === 0 ? (
              <div className="empty-state-mobile">
                <div className="empty-state-icon">
                  <ScanLine size={36} />
                </div>
                <h3>{documents.length === 0 ? "No documents yet" : "No matching documents"}</h3>
                <p>Tap the camera button below to take your first high-speed scan.</p>
              </div>
            ) : (
              <div className="mobile-cards-grid">
                {filteredDocuments.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    onClick={() => {
                      setSelectedId(doc.id);
                      setSelectedPageId(doc.pages[0]?.id ?? "");
                      setCropMode(false);
                      setMarkupMode("off");
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mobile Floating Action Bottom Navigation (When browsing library) */}
        {!selectedDocument && (
          <nav className="mobile-bottom-nav">
            <button
              className="bottom-nav-item"
              onClick={() => imageInputRef.current?.click()}
            >
              <FileImage size={22} />
              <span>Gallery</span>
            </button>

            {/* Primary Glowing Scan FAB */}
            <button
              className="mobile-primary-fab"
              onClick={() => beginScan()}
              aria-label="Scan Document"
            >
              <ScanLine size={26} />
            </button>

            <button
              className="bottom-nav-item"
              onClick={() => encryptedInputRef.current?.click()}
              title="Unlock Encrypted Scan"
            >
              <UnlockKeyhole size={22} />
              <span>Unlock</span>
            </button>
          </nav>
        )}
      </section>

      {/* Dialogs and Toasts */}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {scannerOpen && (
        <CameraSheet
          pageCount={draftPages.length}
          busy={scanBusy}
          onPage={onCapturedPage}
          onFinish={() => void finishScan()}
          onClose={() => {
            setScannerOpen(false);
            setDraftPages([]);
            setScanTargetId(null);
            setScanReplacePageId(null);
          }}
        />
      )}
      {showSetup && <NameSetup initialName={workspaceName} onSave={(n) => { setWorkspaceName(n); localStorage.setItem(APP_NAME_KEY, n); localStorage.setItem(SETUP_KEY, "done"); setShowSetup(false); }} />}
      {toast && <div className="toast-message"><Check size={16} />{toast}</div>}
      {exportBusy && (
        <div className="busy-overlay">
          <LoaderCircle className="spin" size={20} />
          <span>{progressNote || "Processing…"}</span>
        </div>
      )}
    </main>
  );
}

function DocumentCard({ document, onClick }: { document: ScanDocument; onClick: () => void }) {
  const first = document.pages[0];
  const url = useObjectUrl(first?.image);
  return (
    <button className="mobile-doc-card" onClick={onClick}>
      <div className="doc-card-thumb-wrap">
        {url ? (
          <img src={url} alt="" style={{ filter: filterPreview(first.filter) }} />
        ) : (
          <div className="doc-card-placeholder"><FileScan size={28} /></div>
        )}
        <span className="doc-badge-pages">{document.pages.length}p</span>
      </div>
      <div className="doc-card-details">
        <h3 className="doc-title truncate">{document.title || "Untitled scan"}</h3>
        <div className="doc-submeta">
          <span>{document.folder || "Inbox"}</span>
          <span>·</span>
          <span>{formatDate(document.updatedAt)}</span>
        </div>
        {document.ocrText && (
          <span className="ocr-status-pill"><Check size={10} /> OCR ready</span>
        )}
      </div>
    </button>
  );
}
