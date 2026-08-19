/**
 * Stylesheet for the injected editor. Deliberately tiny
 * and self-contained: it is injected into the settings panel and must not
 * collide with the official Models page classes, so every selector is prefixed
 * `bre-`. Uses CSS variables for theme awareness where the host provides them.
 */

/** The stylesheet text, inserted once into <head> by the client apply(). */
export const STYLES = `
.bre-effort-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 4px;
  padding: 10px 12px;
  border: 1px solid var(--dsh-border, rgba(128,128,128,0.25));
  border-radius: 8px;
  background: var(--dsh-surface, rgba(128,128,128,0.06));
  /* The editor mounts inside the official row disclosure, which is a
     `repeat(auto-fit, minmax(160px, 1fr))` grid (context window and max
     tokens take two cells). Spanning the whole row keeps the block from
     being squeezed into one third of the line. */
  grid-column: 1 / -1;
  box-sizing: border-box;
}
.bre-effort-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.bre-effort-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--dsh-text, inherit);
}
.bre-link-button {
  background: none;
  border: none;
  padding: 2px 6px;
  font-size: 12px;
  color: var(--dsh-accent, #4a90d9);
  cursor: pointer;
  border-radius: 4px;
}
.bre-link-button:hover { text-decoration: underline; }
.bre-link-button:disabled { opacity: 0.5; cursor: default; text-decoration: none; }
.bre-effort-grid {
  /* Two columns, the same density as the official capacity fields, so the
     level rows sit beside rather than under each other at full width. */
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 4px 16px;
}
.bre-effort-row {
  display: grid;
  grid-template-columns: 16px 72px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.bre-effort-level { color: var(--dsh-text-secondary, inherit); }
.bre-effort-wire {
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--dsh-border, rgba(128,128,128,0.35));
  border-radius: 4px;
  background: var(--dsh-input, #fff);
  color: inherit;
  font-size: 12px;
}
.bre-effort-empty { min-height: 24px; }
.bre-effort-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.bre-primary-button, .bre-secondary-button {
  height: 26px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--dsh-border, rgba(128,128,128,0.35));
}
.bre-primary-button {
  background: var(--dsh-accent, #4a90d9);
  color: #fff;
  border-color: transparent;
}
.bre-primary-button:disabled, .bre-secondary-button:disabled { opacity: 0.5; cursor: default; }
.bre-secondary-button { background: transparent; color: inherit; }
.bre-effort-message { font-size: 12px; margin: 0; }
.bre-effort-message.bre-success { color: #2e7d32; }
.bre-effort-message.bre-error { color: #c62828; }
.bre-effort-message.bre-info { color: var(--dsh-accent, #4a90d9); }
.bre-effort-note { font-size: 11px; margin: 0; color: var(--dsh-text-secondary, inherit); }
`
