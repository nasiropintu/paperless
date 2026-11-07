import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  Check,
  FileImage,
  FlipHorizontal,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Zap,
  ZapOff,
  X,
} from "lucide-react";
import { detectDocumentCornersInVideo } from "@/lib/scanProcessing";
import type { Point } from "@/lib/scanTypes";

function fitCornersToCamera(
  corners: [Point, Point, Point, Point],
  sourceAspect: number,
  frameAspect: number
): [Point, Point, Point, Point] {
  if (sourceAspect > frameAspect) {
    const scale = sourceAspect / frameAspect;
    return corners.map((point) => ({
      ...point,
      x: point.x * scale - (scale - 1) / 2,
    })) as [Point, Point, Point, Point];
  }
  const scale = frameAspect / sourceAspect;
  return corners.map((point) => ({
    ...point,
    y: point.y * scale - (scale - 1) / 2,
  })) as [Point, Point, Point, Point];
}

interface CameraSheetProps {
  pageCount: number;
  busy: boolean;
  onPage: (image: Blob) => Promise<void>;
  onFinish: () => void;
  onClose: () => void;
}

export default function CameraSheet({
  pageCount,
  busy,
  onPage,
  onFinish,
  onClose,
}: CameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [liveCorners, setLiveCorners] = useState<[Point, Point, Point, Point] | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [autoCapture, setAutoCapture] = useState(true);
  const [flashEffect, setFlashEffect] = useState(false);

  const stableCounterRef = useRef(0);
  const lastCaptureTimeRef = useRef(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await (track as any).applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      // Ignore torch error if unsupported
    }
  }, [torchOn]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Camera stream not available. You can use the Native Camera button or import images."
      );
      return;
    }

    const tryStream = async (constraints: MediaStreamConstraints) => {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);

      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          const capabilities = (track as any).getCapabilities?.();
          if (capabilities && "torch" in capabilities) {
            setTorchAvailable(true);
          }
        } catch {
          setTorchAvailable(false);
        }
      }
    };

    try {
      // 1. Try mobile-safe HD constraints
      await tryStream({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920, max: 2560 },
          height: { ideal: 1080, max: 1920 },
        },
      });
    } catch {
      try {
        // 2. Fallback to basic facing mode constraints
        await tryStream({
          audio: false,
          video: { facingMode: facing },
        });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        setCameraError(
          name === "NotAllowedError"
            ? "Camera permission was denied. Tap 'Native Camera' below or grant camera permissions in settings."
            : name === "NotFoundError"
              ? "No camera found on this device. You can import an image instead."
              : "Camera could not be started. Use the Native Camera button below."
        );
      }
    }
  }, [facing, stopCamera]);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  const capture = useCallback(async () => {
    if (busy) return;
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    // Haptic vibration feedback
    if ("vibrate" in navigator) {
      navigator.vibrate(40);
    }

    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 200);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const image = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.95)
    );
    if (image) {
      lastCaptureTimeRef.current = Date.now();
      stableCounterRef.current = 0;
      await onPage(image);
      setCameraError("");
    }
  }, [busy, onPage]);

  // Real-time document edge detection & auto-capture loop
  useEffect(() => {
    setLiveCorners(null);
    if (!cameraReady) return;

    const interval = window.setInterval(() => {
      const video = videoRef.current;
      const frame = video?.parentElement;
      if (!video || !frame || !video.videoWidth || !frame.clientWidth || !frame.clientHeight) return;

      const found = detectDocumentCornersInVideo(video);
      const next = found
        ? fitCornersToCamera(
            found,
            video.videoWidth / video.videoHeight,
            frame.clientWidth / frame.clientHeight
          )
        : null;

      setLiveCorners((current) => {
        if (!next) {
          stableCounterRef.current = 0;
          return null;
        }

        const isSimilar =
          current &&
          next.every(
            (p, idx) =>
              Math.abs(p.x - current[idx].x) < 0.03 && Math.abs(p.y - current[idx].y) < 0.03
          );

        if (isSimilar) {
          stableCounterRef.current += 1;
        } else {
          stableCounterRef.current = 0;
        }

        // Auto-capture when steady for 3 consecutive intervals (~1.2s)
        if (
          autoCapture &&
          stableCounterRef.current >= 3 &&
          Date.now() - lastCaptureTimeRef.current > 2500
        ) {
          void capture();
        }

        return next;
      });
    }, 400);

    return () => window.clearInterval(interval);
  }, [cameraReady, autoCapture, capture]);

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        await onPage(file);
      }
    }
  };

  return (
    <div className="sheet-backdrop" role="presentation">
      <section className="scan-sheet mobile-fullscreen-scanner" role="dialog" aria-modal="true">
        {/* Shutter flash animation */}
        {flashEffect && <div className="camera-shutter-flash" />}

        {/* Top Controls Bar */}
        <header className="scanner-topbar">
          <button className="icon-circle-btn" onClick={onClose} aria-label="Close scanner">
            <X size={20} />
          </button>

          <div className="scanner-top-center">
            <button
              className={`scanner-pill-toggle ${autoCapture ? "pill-active" : ""}`}
              onClick={() => setAutoCapture(!autoCapture)}
            >
              <Sparkles size={14} />
              <span>{autoCapture ? "Auto Capture" : "Manual"}</span>
            </button>
          </div>

          <div className="scanner-top-actions">
            {torchAvailable && (
              <button
                className={`icon-circle-btn ${torchOn ? "btn-torch-active" : ""}`}
                onClick={toggleTorch}
                title={torchOn ? "Turn off flash" : "Turn on flash"}
              >
                {torchOn ? <Zap size={19} className="text-amber-400" /> : <ZapOff size={19} />}
              </button>
            )}
            <button
              className="icon-circle-btn"
              onClick={() => setFacing((c) => (c === "environment" ? "user" : "environment"))}
              title="Switch camera"
            >
              <FlipHorizontal size={19} />
            </button>
          </div>
        </header>

        {/* Viewfinder Frame */}
        <div className="camera-frame">
          <video
            ref={videoRef}
            className={cameraReady ? "camera-video" : "camera-video camera-hidden"}
            autoPlay
            playsInline
            muted
          />

          {cameraReady && (
            <div className="finder-frame" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          )}

          {cameraReady && liveCorners && (
            <svg
              className="camera-edge-highlight"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon
                points={liveCorners.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
              />
              {liveCorners.map((p, idx) => (
                <circle key={idx} cx={p.x * 100} cy={p.y * 100} r="1.6" />
              ))}
            </svg>
          )}

          {!cameraReady && (
            <div className="camera-placeholder">
              {cameraError ? (
                <>
                  <AlertCircle size={32} className="text-amber-400 mb-2" />
                  <p className="text-sm font-medium px-4 text-center">{cameraError}</p>
                  <label className="native-camera-fallback-btn mt-4">
                    <Camera size={16} />
                    <span>Launch Native Android Camera</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      hidden
                      onChange={(e) => {
                        void importFiles(e.target.files);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </>
              ) : (
                <>
                  <LoaderCircle size={32} className="spin text-blue-500 mb-2" />
                  <p className="text-sm">Initializing camera…</p>
                  <span className="permission-note mt-2">
                    <ShieldCheck size={14} /> Scans stay 100% private on this device.
                  </span>
                </>
              )}
            </div>
          )}

          {/* Status HUD pill */}
          {cameraReady && (
            <div className={`camera-hud-badge ${liveCorners ? "hud-detected" : ""}`}>
              <span className="hud-indicator-dot" />
              <span>{liveCorners ? "Document detected" : "Aim at document"}</span>
            </div>
          )}
        </div>

        {/* Bottom Shutter & Pages Dock */}
        <div className="scanner-bottom-dock">
          {/* Gallery / File Import */}
          <label className="scanner-dock-btn" title="Import from Gallery">
            <FileImage size={22} />
            <span className="dock-btn-label">Gallery</span>
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void importFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </label>

          {/* Shutter Button */}
          <div className="shutter-wrapper">
            <button
              className="scanner-shutter-btn"
              onClick={() => void capture()}
              disabled={!cameraReady || busy}
              aria-label="Capture page"
            >
              <div className="shutter-inner-ring">
                {busy ? <LoaderCircle className="spin" size={24} /> : <div className="shutter-center-core" />}
              </div>
            </button>
          </div>

          {/* Finish / Review Stack */}
          <button
            className="scanner-dock-btn scanner-finish-btn"
            onClick={onFinish}
            disabled={pageCount === 0 || busy}
          >
            <div className="finish-counter-bubble">
              <Check size={18} />
              {pageCount > 0 && <span className="counter-pill">{pageCount}</span>}
            </div>
            <span className="dock-btn-label">Done</span>
          </button>
        </div>
      </section>
    </div>
  );
}
