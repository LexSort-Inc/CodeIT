// Shared context builder: notes + pinned files + matched skills -> system prompt.
// Fixes the v0.1 gap where project.pinned[] was stored but never injected.

export function matchSkills(skills, text, enabledIds) {
  const words = String(text || '').toLowerCase();
  const scored = [];
  for (const s of skills || []) {
    if (enabledIds && !enabledIds.has(s.id)) continue;
    const hay = `${s.name} ${s.description}`.toLowerCase();
    let score = 0;
    for (const w of words.split(/[^a-z0-9]+/).filter((w) => w.length > 3)) {
      if (hay.includes(w)) score += 2;
    }
    // trigger phrases from catalog get bonus
    for (const t of (s.triggers || [])) {
      if (words.includes(String(t).toLowerCase())) score += 3;
    }
    if (score > 0) scored.push({ skill: s, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 2).map((x) => x.skill);
}

export function buildSystemPrompt({ notes, pinsText, skills, identity }) {
  const who = identity || 'an AI coding assistant';
  const parts = [`You are ${who}, running inside the CodeIT app. If asked what model you are, answer with exactly that identity and nothing else. Be concise. When asked to edit code, output the full replacement file content in a fenced code block.`];
  if (notes) parts.push(`--- PROJECT NOTES ---\n${String(notes).slice(0, 4000)}`);
  if (pinsText) parts.push(`--- PINNED FILES ---\n${String(pinsText).slice(0, 12000)}`);
  for (const s of skills || []) {
    parts.push(`--- SKILL: ${s.name} ---\n${String(s.body || s.description || '').slice(0, 5000)}`);
  }
  return parts.join('\n\n');
}
