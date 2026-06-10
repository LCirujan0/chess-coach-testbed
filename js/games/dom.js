// ============================================================================
// SECTION 3. DOM HELPERS
// ============================================================================

const $ = (id) => document.getElementById(id);

function setProgress(text, pct, cls = '') {
  $('progress').classList.remove('hidden', 'error', 'ok');
  if (cls) $('progress').classList.add(cls);
  $('progress-text').textContent = text;
  $('progress-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export { $, setProgress, escapeHtml };
