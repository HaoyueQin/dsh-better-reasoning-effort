/**
 * Stylesheet for the injected editor and the fallback page. Deliberately tiny
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
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 4px 12px;
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

/* Fallback page */
.bre-section { display: flex; flex-direction: column; gap: 12px; }
.bre-section h2 { margin: 0; font-size: 16px; }
.bre-section p { margin: 0; font-size: 13px; }
.bre-section .bre-readonly { font-size: 12px; opacity: 0.8; }
.bre-provider-block { border: 1px solid var(--dsh-border, rgba(128,128,128,0.25)); border-radius: 8px; padding: 10px 12px; }
.bre-provider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.bre-provider-name { font-weight: 600; font-size: 13px; }
.bre-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.bre-preset-button {
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  border: 1px solid var(--dsh-border, rgba(128,128,128,0.35));
  background: transparent;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}
.bre-preset-button:disabled { opacity: 0.5; cursor: default; }
.bre-model-list { display: flex; flex-direction: column; gap: 4px; }
.bre-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 6px;
}
.bre-model-row:hover { background: var(--dsh-surface, rgba(128,128,128,0.06)); }
.bre-model-id { font-weight: 600; min-width: 120px; }
.bre-model-levels { color: var(--dsh-text-secondary, inherit); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bre-model-actions { display: flex; gap: 6px; }
.bre-inline-button {
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid var(--dsh-border, rgba(128,128,128,0.35));
  background: transparent;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}
.bre-inline-button:disabled { opacity: 0.5; cursor: default; }
.bre-status { font-size: 12px; }
.bre-status.bre-active { color: #2e7d32; }
.bre-status.bre-inactive { color: #c62828; }
`
