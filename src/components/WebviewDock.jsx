import { useState } from 'react';

// Electron <webview> dock for free web models (logged-in sessions, no API key).
// Falls back to external links when running as plain web preview.
const TABS = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'claude', label: 'Claude', url: 'https://claude.ai/' },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/' }
];

export default function WebviewDock() {
  const [tab, setTab] = useState(TABS[0]);
  const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: 6, borderBottom: '1px solid #30363d' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t)} style={{ fontWeight: tab.id === t.id ? 'bold' : 'normal' }}>{t.label}</button>
        ))}
        {!isElectron && <a href={tab.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, marginLeft: 8 }}>open ↗</a>}
      </div>
      <div style={{ flex: 1, position: 'relative', background: '#0d1117' }}>
        {/* NOTE: React unknown-element warning for <webview> is expected in dev; Electron handles it. */}
        {typeof window !== 'undefined' && window.codeit ? (
          <webview src={tab.url} partition="persist:webdock" style={{ width: '100%', height: '100%' }} />
        ) : (
          <div style={{ padding: 12, fontSize: 13 }}>Webview tabs need Electron (`npm run dev`). In browser preview, use the open ↗ link.</div>
        )}
      </div>
    </div>
  );
}
