import { useEffect } from "react";
import { ExternalLink, Heart, X } from "lucide-react";

const profiles = [
  ["GitHub", "@nasiropintu", "https://github.com/nasiropintu"],
  ["X", "@nasiropintu", "https://x.com/nasiropintu"],
  ["Instagram", "@the_np2", "https://www.instagram.com/the_np2/"],
  ["Facebook", "mohammadnasiruddin.pintu", "https://www.facebook.com/mohammadnasiruddin.pintu/"],
];

export default function AboutDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <div className="about-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <button className="about-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
      <div className="about-creator-mark" aria-label="NasirPintu initials">NP</div>
      <div className="about-heart"><Heart size={18} fill="currentColor" /></div>
      <p className="about-kicker">CREATOR & OPEN-SOURCE BUILDER</p>
      <h2 id="about-title">NasirPintu</h2>
      <p className="about-subtitle">Mohammad Nasiruddin Pintu · Creator & Product Architect</p>
      <p className="about-bio">Building free, privacy-minded tools that keep people in control of their documents and data.</p>
      <div className="about-links">{profiles.map(([name, handle, href]) => <a key={name} href={href} target="_blank" rel="noreferrer">{name}<span>{handle}</span><ExternalLink size={13} /></a>)}</div>
      <p className="about-collaboration">Paperless is open source and built with community software. AI coding assistance has contributed to this codebase; specific assistant credits are included when the contribution is verifiable.</p>
      <p className="about-privacy">Your scans are processed locally in this browser.</p>
    </section>
  </div>;
}
