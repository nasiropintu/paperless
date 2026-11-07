import { useEffect, useState } from "react";
import {
  X,
  Heart,
  ExternalLink,
  Sparkles,
  Bot,
  Code2,
  ShieldCheck,
  Smartphone,
  Layers,
} from "lucide-react";

interface AboutDialogProps {
  onClose: () => void;
}

const socialLinks = [
  {
    name: "GitHub",
    handle: "@nasiropintu",
    url: "https://github.com/nasiropintu",
    color: "#24292e",
  },
  {
    name: "X (Twitter)",
    handle: "@nasiropintu",
    url: "https://x.com/nasiropintu",
    color: "#000000",
  },
  {
    name: "Instagram",
    handle: "@the_np2",
    url: "https://www.instagram.com/the_np2/",
    color: "#E1306C",
  },
  {
    name: "Facebook",
    handle: "mohammadnasiruddin.pintu",
    url: "https://www.facebook.com/mohammadnasiruddin.pintu/",
    color: "#1877F2",
  },
];

const aiCollaborators = [
  {
    name: "Gemini",
    provider: "Google DeepMind",
    role: "Architecture, Mobile UI & Agentic Workflows",
  },
  {
    name: "Manus",
    provider: "Manus AI",
    role: "Autonomous Planning & System Synthesis",
  },
  {
    name: "ChatGPT",
    provider: "OpenAI",
    role: "Logic Optimization & Reasoning",
  },
  {
    name: "DeepSeek",
    provider: "DeepSeek",
    role: "Algorithmic Engineering & Core Logic",
  },
  {
    name: "Claude",
    provider: "Anthropic",
    role: "Systems Architecture & Clean Design",
  },
  {
    name: "Vibe by Mistral",
    provider: "Mistral AI",
    role: "Fast Generation & Execution",
  },
];

const openSourceCredits = [
  {
    name: "Google ML Kit Document Scanner",
    author: "Google / Capawesome",
    desc: "Hardware-accelerated on-device document boundary tracking, perspective correction, shadow removal, and finger erasing.",
  },
  {
    name: "Capacitor",
    author: "Ionic Team",
    desc: "Cross-platform native Android runtime powering camera hardware, flashlight, and file access.",
  },
  {
    name: "Tesseract.js",
    author: "Naptha / Tesseract OCR",
    desc: "Pure client-side WebAssembly optical character recognition for extracting searchable text.",
  },
  {
    name: "PDF-Lib",
    author: "Andrew Dillon",
    desc: "Client-side PDF compilation, password protection, and high-resolution document generation.",
  },
  {
    name: "Lucide React",
    author: "Lucide Community",
    desc: "Beautiful, consistent, and lightweight UI icon system.",
  },
  {
    name: "Tailwind CSS & Vite",
    author: "Tailwind Labs & Vite Core",
    desc: "High-performance frontend styling and instant bundle compilation.",
  },
];

export default function AboutDialog({ onClose }: AboutDialogProps) {
  const [photoError, setPhotoError] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="about-modal-card" onClick={(e) => e.stopPropagation()}>
        <button
          className="about-modal-close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>

        {/* Creator Hero Header */}
        <div className="creator-hero">
          <div className="creator-avatar-wrap">
            {!photoError ? (
              <img
                src={`${import.meta.env.BASE_URL}nasirpintu.jpg`}
                alt="NasirPintu"
                className="creator-avatar-img"
                onError={() => setPhotoError(true)}
              />
            ) : (
              <div className="creator-avatar-fallback">
                <span>NP</span>
              </div>
            )}
            <div className="creator-avatar-badge" title="Creator Verified">
              <Sparkles size={11} />
            </div>
          </div>

          <div className="creator-meta">
            <div className="creator-tagline-pill">
              <Heart
                size={11}
                style={{ fill: "currentColor", color: "#e54b24" }}
              />
              <span>Crafted with Love</span>
            </div>
            <h2 className="creator-name">NasirPintu</h2>
            <p className="creator-subtitle">
              Mohammad Nasiruddin Pintu · Creator &amp; Product Architect
            </p>
            <p className="creator-bio">
              Building 100% free, private-by-design, serverless digital tools that
              empower individuals without paywalls, subscriptions, tracking, or
              data surveillance.
            </p>
          </div>
        </div>

        {/* App Version & Build Status */}
        <div className="about-section">
          <div className="app-version-banner">
            <div className="flex items-center gap-3">
              <div className="version-icon-box">
                <Smartphone size={20} />
              </div>
              <div>
                <h3 className="version-title">Paperless</h3>
                <p className="version-desc">
                  Mobile Android App &amp; Offline PWA Desk
                </p>
              </div>
            </div>
            <div className="version-badge-group">
              <span className="version-pill">v1.2.0</span>
              <span className="build-pill">Build 2026.11</span>
            </div>
          </div>
        </div>

        {/* Official Social Links */}
        <div className="about-section">
          <div className="about-section-label">CONNECT WITH NASIRPINTU</div>
          <div className="social-links-grid">
            {socialLinks.map((s) => (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="social-pill"
              >
                <span className="social-info">
                  <strong>{s.name}</strong>
                  <small>{s.handle}</small>
                </span>
                <ExternalLink size={12} className="social-arrow" />
              </a>
            ))}
          </div>
        </div>

        {/* Mandatory AI Agent Collaboration Credits */}
        <div className="about-section">
          <div className="about-section-head">
            <div className="about-section-label">
              <Bot size={13} style={{ display: "inline", marginRight: 6 }} />
              AI AGENT COLLABORATION CREDITS
            </div>
            <span className="ai-sublabel">Human-Directed · Agent-Assisted</span>
          </div>
          <p className="about-narrative">
            Architected and guided by <strong>NasirPintu</strong> in active
            synergy with frontier artificial intelligence models and autonomous
            coding agents. This project demonstrates the future of human-directed,
            agent-assisted engineering.
          </p>
          <div className="ai-agents-grid">
            {aiCollaborators.map((ai) => (
              <div key={ai.name} className="ai-agent-chip">
                <div className="ai-agent-dot" />
                <div className="ai-agent-text">
                  <strong>{ai.name}</strong>
                  <span className="ai-agent-provider">{ai.provider}</span>
                  <span className="ai-agent-role">{ai.role}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Open-Source Community Credits */}
        <div className="about-section">
          <div className="about-section-label">
            <Code2 size={13} style={{ display: "inline", marginRight: 6 }} />
            OPEN-SOURCE COMMUNITY CREDITS
          </div>
          <div className="oss-grid">
            {openSourceCredits.map((oss) => (
              <div key={oss.name} className="oss-card">
                <div className="oss-head">
                  <strong>{oss.name}</strong>
                  <span>by {oss.author}</span>
                </div>
                <p>{oss.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Privacy Guarantee Footer */}
        <div className="about-modal-footer">
          <ShieldCheck size={16} style={{ color: "#24755f", flexShrink: 0 }} />
          <span>
            <strong>Privacy Guarantee:</strong> All document scanning,
            straightening, and OCR stays strictly on your device. Zero telemetry.
            Zero cloud uploads. 100% private.
          </span>
        </div>
      </div>
    </div>
  );
}
