/**
 * Stylesheet for the injected editor. Deliberately tiny
 * and self-contained: it is injected into the settings panel and must not
 * collide with the official Models page classes, so every selector is prefixed
 * `bre-`. Uses CSS variables for theme awareness where the host provides them.
 */

/** The stylesheet text, inserted once into <head> by the client apply(). */
export const STYLES = `
/* The injector's mount wrapper. It — not the editor inside it — is the item
   placed into the official row disclosure's repeat(auto-fit, minmax(160px,1fr))
   grid (context window and max tokens take two cells), so the span belongs
   here: on the editor itself it would target the wrapper's block box and be
   ignored, squeezing the block into one cell. */
.bre-effort-slot {
  grid-column: 1 / -1;
}
.bre-effort-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 4px;
  padding: 10px 12px;
  border: 1px solid var(--dsh-border, rgba(128,128,128,0.25));
  border-radius: 8px;
  background: var(--dsh-surface, rgba(128,128,128,0.06));
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
  /* Exactly two equal columns mirroring the official capacity pair the editor
     sits under; an odd row count leaves the last cell in the left column,
     so the left side carries the extra level. */
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 16px;
}
.bre-effort-row {
  display: grid;
  grid-template-columns: 20px 76px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.bre-effort-row input[type='checkbox'] {
  /* Bigger than the browser default (~13px): a tap/point target that does
     not require precision, in the theme accent when checked. */
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--dsh-accent, #4a90d9);
  cursor: pointer;
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
/* ---- Input-modality section ---- */
.bre-modality {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bre-modality-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.bre-modality-row input[type='checkbox'] {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--dsh-accent, #4a90d9);
  cursor: pointer;
}
.bre-modality-clear { margin-left: auto; }
.bre-modality-note { font-size: 11px; margin: 0; color: var(--dsh-text-secondary, inherit); }
/* ---- Zoned suggestion display ---- */
.bre-suggestion {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.bre-reference {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 14px;
  padding: 6px 8px;
  border: 1px dashed var(--dsh-border, rgba(128,128,128,0.35));
  border-radius: 6px;
  font-size: 11px;
  color: var(--dsh-text-secondary, inherit);
}
.bre-reference-title { font-weight: 600; }
.bre-reference-values { display: inline-flex; gap: 14px; }
/* ---- alpha.1 slot-mode panel ---- */
.bre-provider-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 4px;
}
.bre-provider-panel-empty {
  font-size: 12px;
  color: var(--dsh-text-secondary, inherit);
}
.bre-provider-panel-failed {
  font-size: 12px;
  color: #c62828;
}
`
