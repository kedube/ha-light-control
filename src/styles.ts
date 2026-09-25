import { css } from 'lit';

/** Theme hooks shared by every element. All fall back to Home Assistant's own variables. */
export const themeVars = css`
  :host {
    --lc-radius: var(--ha-card-border-radius, 16px);
    --lc-text: var(--primary-text-color, #1c1c1c);
    --lc-text-2: var(--secondary-text-color, #6b6b6b);
    --lc-rgb-text: var(--rgb-primary-text-color, 28, 28, 28);
    --lc-bg: var(--ha-card-background, var(--card-background-color, #fff));
    --lc-surface: rgba(var(--lc-rgb-text), 0.045);
    --lc-surface-2: rgba(var(--lc-rgb-text), 0.08);
    --lc-line: rgba(var(--lc-rgb-text), 0.42);
    --lc-glass-off: rgba(var(--lc-rgb-text), 0.06);
    --lc-outlet: var(--lc-outlet-rgb, 38, 196, 152);
  }
`;

/** Styles for the bulb and outlet artwork from graphics.ts. */
export const artStyles = css`
  .art {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .bulb .glass {
    stroke: var(--lc-line);
    stroke-width: 2;
    transition: stroke 0.3s ease;
  }
  .bulb .glass:not(.lit) {
    fill: var(--lc-glass-off);
  }
  .bulb .glass.lit {
    stroke: rgba(var(--lc-c), 0.95);
    stroke-width: 1.2;
  }
  .bulb .highlight {
    fill: none;
    stroke: rgba(var(--lc-rgb-text), 0.25);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .bulb .glass.lit ~ .highlight {
    stroke: rgba(255, 255, 255, 0.85);
  }
  .bulb .filament {
    fill: none;
    stroke: var(--lc-line);
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .bulb .glass.lit ~ .filament {
    stroke: rgba(255, 255, 255, 0.95);
  }
  .bulb .base {
    fill: var(--lc-line);
  }
  .bulb .rays line {
    stroke: rgba(var(--lc-c), 1);
    stroke-width: 2.4;
    stroke-linecap: round;
  }
  .bulb .back {
    opacity: 0.6;
  }
  .outlet .plate {
    fill: var(--lc-glass-off);
    stroke: var(--lc-line);
    stroke-width: 2;
    transition:
      fill 0.3s ease,
      stroke 0.3s ease;
  }
  .outlet .recess {
    fill: rgba(var(--lc-rgb-text), 0.06);
    stroke: var(--lc-line);
    stroke-width: 1.3;
  }
  .outlet .hole {
    fill: var(--lc-line);
  }
  .outlet .led {
    fill: var(--lc-line);
    opacity: 0.35;
    transition:
      fill 0.3s ease,
      opacity 0.3s ease;
  }
  .outlet .badge circle {
    fill: #ffc940;
    stroke: var(--lc-bg);
    stroke-width: 2;
  }
  .outlet .badge path {
    fill: #3a2a00;
  }
  .is-on .outlet .plate {
    fill: rgba(var(--lc-outlet), 0.16);
    stroke: rgb(var(--lc-outlet));
  }
  .is-on .outlet .recess {
    stroke: rgba(var(--lc-outlet), 0.8);
  }
  .is-on .outlet .hole {
    fill: rgba(var(--lc-outlet), 0.9);
  }
  .is-on .outlet .led {
    fill: rgb(var(--lc-outlet));
    opacity: 1;
    filter: drop-shadow(0 0 2.5px rgb(var(--lc-outlet)));
  }
`;

export const buttonReset = css`
  button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    margin: 0;
    padding: 0;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  button:focus-visible,
  [tabindex]:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }
  .mdi {
    width: 20px;
    height: 20px;
    fill: currentColor;
    flex: none;
  }
`;
