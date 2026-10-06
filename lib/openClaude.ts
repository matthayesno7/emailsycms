'use client';
// Open a prompt in Claude: the desktop app when it's installed (claude:// link), otherwise claude.ai.
// The prompt is prefilled, not sent. Claude truncates very long prompts (~14,000 characters).
//
// We can't ask the browser whether the app is installed, so: try the app link, and if the page
// is still in front a moment later (no app took over), open claude.ai instead. Once the app has
// opened, we remember it and go straight there next time.

const KEY = 'mise.claudeApp';

export function openInClaude(prompt: string, opts: { web?: boolean } = {}) {
  const q = encodeURIComponent(prompt.slice(0, 14000));
  const web = () => window.open(`https://claude.ai/new?q=${q}`, '_blank', 'noopener');
  let pref: string | null = null;
  try { pref = localStorage.getItem(KEY); } catch {}
  if (opts.web || pref === 'web') { web(); return; }

  let left = false;
  const onBlur = () => { left = true; };
  window.addEventListener('blur', onBlur, { once: true });
  document.addEventListener('visibilitychange', onBlur, { once: true });
  window.location.href = `claude://claude.ai/new?q=${q}`;
  setTimeout(() => {
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onBlur);
    if (left) { try { localStorage.setItem(KEY, 'app'); } catch {} return; }
    if (pref !== 'app' && document.hasFocus()) web(); // no app took over: use claude.ai
  }, 2500);
}

// "Use claude.ai instead" / "use the app": lets people switch.
export function setClaudePreference(where: 'app' | 'web') {
  try { localStorage.setItem(KEY, where); } catch {}
}
