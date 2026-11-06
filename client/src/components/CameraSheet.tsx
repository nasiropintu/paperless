import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, Check, FileImage, FlipHorizontal, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { detectDocumentCornersInVideo } from "@/lib/scanProcessing";
import type { Point } from "@/lib/scanTypes";

function fitCornersToCamera(corners: [Point, Point, Point, Point], sourceAspect: number, frameAspect: number): [Point, Point, Point, Point] {
  if (sourceAspect > frameAspect) {
    const scale = sourceAspect / frameAspect;
    return corners.map((point) => ({ ...point, x: point.x * scale - (scale - 1) / 2 })) as [Point, Point, Point, Point];
  }
  const scale = frameAspect / sourceAspect;
  return corners.map((point) => ({ ...point, y: point.y * scale - (scale - 1) / 2 })) as [Point, Point, Point, Point];
}

interface CameraSheetProps {
  pageCount: number;
  busy: boolean;
  onPage: (image: Blob) => Promise<void>;
  onFinish: () => void;
  onClose: () => void;
}

export default function CameraSheet({ pageCount, busy, onPage, onFinish, onClose }: CameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [liveCorners, setLiveCorners] = useState<[Point, Point, Point, Point] | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser does not expose camera capture here. Choose a photo instead, or open Paperless in a secure browser tab.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1920 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setCameraError(name === "NotAllowedError"
        ? "Camera access is blocked. Allow camera permission in your browser’s site settings, then try again. You can still import an image."
        : name === "NotFoundError"
          ? "No camera was found on this device. You can still import an image."
          : "Paperless could not start the camera. Check browser permissions or import an image instead.");
    }
  }, [facing, stopCamera]);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  useEffect(() => {
    setLiveCorners(null);
    if (!cameraReady) return;
    const interval = window.setInterval(() => {
      const video = videoRef.current;
      const frame = video?.parentElement;
      if (!video || !frame || !video.videoWidth || !frame.clientWidth || !frame.clientHeight) return;
      const found = detectDocumentCornersInVideo(video);
      const next = found ? fitCornersToCamera(found, video.videoWidth / video.videoHeight, frame.clientWidth / frame.clientHeight) : null;
      setLiveCorners((current) => {
        if (!next) return null;
        if (current && next.every((point, index) => Math.abs(point.x - current[index].x) < 0.004 && Math.abs(point.y - current[index].y) < 0.004)) return current;
        return next;
      });
    }, 500);
    return () => window.clearInterval(interval);
  }, [cameraReady]);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
    if (image) {
      await onPage(image);
      setCameraError("");
    }
  };

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) await onPage(file);
    }
  };

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="scan-sheet" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
        <header className="sheet-header">
          <div>
            <p className="eyebrow">DOCUMENT SCANNER</p>
            <h2 id="scanner-title">Capture a page</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close scanner"><X size={18} /></button>
        </header>
        <div className="camera-frame">
          <video ref={videoRef} className={cameraReady ? "camera-video" : "camera-video camera-hidden"} autoPlay playsInline muted />
          {cameraReady && <div className="finder-frame" aria-hidden="true"><span /><span /><span /><span /></div>}
          {cameraReady && liveCorners && <svg className="camera-edge-highlight" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polygon points={liveCorners.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")} />
            {liveCorners.map((point, index) => <circle key={index} cx={point.x * 100} cy={point.y * 100} r="1.4" />)}
          </svg>}
          {!cameraReady && (
            <div className="camera-placeholder">
              {cameraError ? <AlertCircle size={28} /> : <LoaderCircle size={28} className="spin" />}
              <p>{cameraError || "Connecting to your camera…"}</p>
              {cameraError && <span className="permission-note"><ShieldCheck size={14} /> Images stay on this device.</span>}
            </div>
          )}
          <div className={`camera-count ${liveCorners ? "page-found" : ""}`}><span className="count-dot" />{liveCorners ? "Page found" : "Line up a page"}<span aria-hidden="true">·</span>{pageCount} {pageCount === 1 ? "page" : "pages"} ready</div>
        </div>
        <div className="scanner-actions">
          <label className="button button-quiet import-action">
            <FileImage size={17} /> Add image
            <input type="file" accept="image/*" multiple hidden onChange={(event) => { void importFiles(event.target.files); event.currentTarget.value = ""; }} />
          </label>
          <button className="capture-button" onClick={() => void capture()} disabled={!cameraReady || busy} aria-label="Capture page">
            {busy ? <LoaderCircle className="spin" size={23} /> : <Camera size={23} />}
          </button>
          <button className="button button-quiet flip-action" onClick={() => setFacing((current) => current === "environment" ? "user" : "environment")}>
            <FlipHorizontal size={17} /> Flip
          </button>
        </div>
        <div className="sheet-footer">
          <p>{pageCount === 0 ? "Line up a document inside the frame, or choose an image." : `${pageCount} page${pageCount === 1 ? "" : "s"} captured. Add more or finish the scan.`}</p>
          <button className="button button-primary" onClick={onFinish} disabled={busy || pageCount === 0}>
            <Check size={16} /> Save scan
          </button>
        </div>
      </section>
    </div>
  );
}
