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
      <div className="pane-title tabs" style={{ justifyContent: 'space-between' }}>
        <Tabs tabs={TABS.map((t) => t.id)} active={tab} onChange={setTab}
          labels={Object.fromEntries(TABS.map((t) => [t.id, t.label]))} />
        <a href={current.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost" style={{ fontSize: 11, textDecoration: 'none' }}>
          open in browser ↗
        </a>
      </div>
      <div style={{ flex: 1, position: 'relative', background: 'var(--bg1)', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {typeof window !== 'undefined' && window.codeit ? (
          <webview
            key={current.id}
            src={current.url}
            partition="persist:webdock"
            allowpopups="true"
            useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
            style={{ width: '100%', height: '100%', border: 'none', flex: 1 }}
          />
        ) : (
          <Empty>Webview tabs need Electron (`npm run dev`). In browser preview, use the open in browser link above.</Empty>
        )}
      </div>
    </div>
  );
}
