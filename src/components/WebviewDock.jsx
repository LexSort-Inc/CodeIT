import { useState } from 'react';
import { Tabs, Empty } from './ui.jsx';

// Electron <webview> dock for free web models (logged-in sessions, no API key).
// Falls back to external links when running as plain web preview.
const TABS = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'claude', label: 'Claude', url: 'https://claude.ai/' },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/' }
];

export default function WebviewDock() {
  const [tab, setTab] = useState(TABS[0].id);
  const current = TABS.find((t) => t.id === tab);
  const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="pane-title tabs">
        <Tabs tabs={TABS.map((t) => t.id)} active={tab} onChange={setTab}
          labels={Object.fromEntries(TABS.map((t) => [t.id, t.label]))} />
        {!isElectron && <a href={current.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, marginLeft: 8 }}>open ↗</a>}
      </div>
      <div style={{ flex: 1, position: 'relative', background: 'var(--bg1)' }}>
        {/* NOTE: React unknown-element warning for <webview> is expected in dev; Electron handles it. */}
        {typeof window !== 'undefined' && window.codeit ? (
          <webview key={current.id} src={current.url} partition="persist:webdock" style={{ width: '100%', height: '100%' }} />
        ) : (
          <Empty>Webview tabs need Electron (`npm run dev`). In browser preview, use the open ↗ link.</Empty>
        )}
      </div>
    </div>
  );
}
