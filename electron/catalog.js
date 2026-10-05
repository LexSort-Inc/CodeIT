// Curated tool catalog — audited, offline-first, version-pinned where known.
// kind: 'mcp' (runnable server, needs MCP runtime) | 'skill' (markdown+scripts, files only)
// risk: 'read' (auto-approvable) | 'write' (always prompts)
// localReady: works with small local models · cloudPreferred: suggest Groq/Gemini for multi-step
// Verdicts from deep research (Oct 2026): registry.modelcontextprotocol.io,
// modelcontextprotocol/servers, brave-search-mcp-server, context7-mcp,
// skills.sh, anthropics/skills, obra/superpowers.

const CATALOG = [
  // ---------- MCP servers (npx, stdio) ----------
  {
    id: 'mcp:filesystem', kind: 'mcp', name: 'Filesystem', risk: 'write',
    blurb: 'Scoped file read/write/list. Allowlisted to the active project folder only.',
    localReady: true, cloudPreferred: false, needsKey: null,
    transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '__PROJECT_DIR__'],
    docs: 'https://github.com/modelcontextprotocol/servers'
  },
  {
    id: 'mcp:memory', kind: 'mcp', name: 'Memory', risk: 'write',
    blurb: 'Persistent knowledge graph across chats in this project. Fully offline.',
    localReady: true, cloudPreferred: false, needsKey: null,
    transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'],
    docs: 'https://github.com/modelcontextprotocol/servers'
  },
  {
    id: 'mcp:sequentialthinking', kind: 'mcp', name: 'Sequential Thinking', risk: 'read',
    blurb: 'Step-by-step reflective reasoning. Noticeably helps 7B local models.',
    localReady: true, cloudPreferred: false, needsKey: null,
    transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequentialthinking'],
    docs: 'https://github.com/modelcontextprotocol/servers'
  },
  {
    id: 'mcp:brave-search', kind: 'mcp', name: 'Brave Search', risk: 'read',
    blurb: 'Web search with AI snippets. Free tier key. Long results can overwhelm small models.',
    localReady: false, cloudPreferred: true, needsKey: 'brave',
    transport: 'stdio', command: 'npx', args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
    env: { BRAVE_API_KEY: '${key:brave}' },
    docs: 'https://github.com/brave/brave-search-mcp-server'
  },
  {
    id: 'mcp:context7', kind: 'mcp', name: 'Context7 Docs', risk: 'read',
    blurb: 'Version-specific library docs injected on demand. Stops small models hallucinating APIs.',
    localReady: true, cloudPreferred: false, needsKey: null,
    transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'],
    docs: 'https://github.com/upstash/context7-mcp'
  },
  // ---------- Skills (files only — work with any provider, zero deps) ----------
  {
    id: 'skill:commit-helper', kind: 'skill', name: 'Commit Helper', risk: 'read',
    blurb: 'Conventional commits: stage, message format, PR title. Deterministic script.',
    localReady: true, cloudPreferred: false, needsKey: null,
    triggers: ['commit', 'conventional', 'pr title', 'stage', 'push message'],
    docs: 'skills.sh + juliusbrussee/caveman pattern'
  },
  {
    id: 'skill:test-runner', kind: 'skill', name: 'Test Runner', risk: 'read',
    blurb: 'Detect + run the project test command, parse failures into fixes.',
    localReady: true, cloudPreferred: false, needsKey: null,
    triggers: ['test', 'failing', 'jest', 'pytest', 'npm test', 'ci'],
    docs: '.agents/skills/test-runner/SKILL.md'
  },
  {
    id: 'skill:project-notes', kind: 'skill', name: 'Project Notes', risk: 'read',
    blurb: 'Reads .codeit/CONTEXT.md conventions before answering. CodeIT-native.',
    localReady: true, cloudPreferred: false, needsKey: null,
    triggers: ['convention', 'stack', 'architecture', 'where is', 'how does this project'],
    docs: '.agents/skills/project-notes/SKILL.md'
  },
  {
    id: 'skill:code-review', kind: 'skill', name: 'Code Review (lite)', risk: 'read',
    blurb: 'Lint-level review checklist. Deep architecture review still wants cloud.',
    localReady: true, cloudPreferred: true, needsKey: null,
    triggers: ['review', 'look over', 'check my code', 'pr review'],
    docs: 'obra/superpowers requesting-code-review pattern'
  }
];

module.exports = { CATALOG };
