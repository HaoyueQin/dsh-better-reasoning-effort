/**
 * The reasoning-effort slider enable toggle. The item form is the upstream
 * plugin's setting row ported VERBATIM (title, description, state, switch —
 * colors, sizes and spacing included), wrapped in the requested boxed
 * container on the Models settings page below the add-provider and
 * add-custom-provider actions. Mounted through two seats: the alpha.1
 * 'settings.models.footer' slot, and the rc.2 DOM fallback (the rc.2 Models
 * section declares no extension slots).
 *
 * The big-fish slider setting is deliberately gone: that feature was not
 * carried into this integration.
 *
 * @module dsh-better-reasoning-effort/client/SliderToggle
 */
import { createElement, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { setSliderEnabled, sliderEnabled, subscribeSliderEnabled } from './slider-pref.js'

export interface SliderToggleProps {
  /** Localized copy (the plugin's bound translator). */
  t: (key: string, params?: Record<string, string | number>) => string
}

/** One boxed setting row: label copy (upstream .re-setting-row form), live state, and the switch. */
export function SliderToggle(props: SliderToggleProps): ReactNode {
  const { t } = props
  const enabled = useSyncExternalStore(subscribeSliderEnabled, sliderEnabled)
  const toggle = (): void => { setSliderEnabled(!enabled) }
  return createElement(
    'div',
    { className: 'bre-slider-setting' },
    createElement('div', { className: 'bre-slider-setting-row' },
      createElement('div', { className: 'bre-slider-setting-copy' },
        createElement('div', { className: 'bre-slider-setting-title' }, t('sliderToggleTitle')),
        createElement('div', { className: 'bre-slider-setting-description' }, t('sliderToggleDescription')),
      ),
      createElement('div', { className: 'bre-slider-setting-control' },
        createElement('span', { className: 'bre-slider-setting-state' }, enabled ? t('settingOn') : t('settingOff')),
        createElement('button', {
          type: 'button',
          role: 'switch',
          'aria-label': t('sliderToggleAria'),
          'aria-checked': enabled,
          className: 'bre-slider-setting-switch' + (enabled ? ' is-on' : ''),
          onClick: toggle,
        }, createElement('span', { className: 'bre-slider-setting-switch-knob', 'aria-hidden': true })),
      ),
    ),
  )
}
