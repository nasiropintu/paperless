import { useState } from "react";
import { ArrowRight, Check, FileScan } from "lucide-react";

const suggestions = ["Paperless", "Scanly", "ClearScan", "SnapDoc", "DocuNest"];

interface NameSetupProps {
  initialName: string;
  onSave: (name: string) => void;
}

export default function NameSetup({ initialName, onSave }: NameSetupProps) {
  const [name, setName] = useState(initialName || "Paperless");
  return (
    <div className="sheet-backdrop welcome-backdrop">
      <section className="name-setup" role="dialog" aria-modal="true" aria-labelledby="name-setup-title">
        <div className="setup-brand"><span className="brand-mark"><FileScan size={21} /></span><span>Paperless <span className="beta-label">LOCAL EDITION</span></span></div>
        <div className="setup-icon"><FileScan size={26} /></div>
        <p className="eyebrow">A QUIETER WAY TO SCAN</p>
        <h1 id="name-setup-title">Your documents,<br />back in your hands.</h1>
        <p className="setup-copy">Capture, refine, and organize documents on this device. No account. No subscription. No uploads.</p>
        <label className="field-label" htmlFor="app-name">Choose a name for your workspace</label>
        <div className="name-input-wrap">
          <input id="app-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={32} autoComplete="off" />
          {name.trim() && <span className="input-check"><Check size={15} /></span>}
        </div>
        <div className="name-suggestions" aria-label="Suggested names">
          {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setName(suggestion)} className={`name-chip ${name === suggestion ? "selected" : ""}`}>{suggestion}</button>)}
        </div>
        <button className="button button-primary setup-continue" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Open workspace <ArrowRight size={16} /></button>
        <div className="privacy-line"><span className="privacy-dot" /> Your scans are stored locally in this browser.</div>
      </section>
    </div>
  );
}
