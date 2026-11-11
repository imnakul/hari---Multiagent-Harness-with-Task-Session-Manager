import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * The session-title particle sweep (`shared/ui/ParticleText`), for a whole
 * composer: the rewrite sweeps in from left to right while the draft it
 * replaces bursts into particles at the edge. A separate copy so the upstream
 * title component stays untouched; the timing and look match it.
 */

/** Room around the text for particles drifting past its box. */
const PAD = 20;
/** Sampling step in CSS pixels; a composer is larger than a title. */
const STEP = 2;
/** Most particles drawn per frame, so a long draft stays smooth. */
const MAX_PARTICLES = 3_500;
/** Time for the reveal edge to cross the text, as for session titles. */
const SWEEP_MS = 1100;
/** Softness of the reveal edge. */
const EDGE = 18;
const PARTICLE_MS = 850;
/** A reveal older than this is history (the composer remounted), not news. */
const STALE_MS = 1_000;

/** One rewrite landing in the composer; `id` changes for each one. */
export type RewriteRevealEvent = { id: number; from: string; at: number };

type Particle = {
  x: number;
  y: number;
  alpha: number;
  vx: number;
  vy: number;
  life: number;
};

function reducedMotion(): boolean {
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Break `text` into the lines a `pre-wrap` box of `width` would show. */
export function wrapLines(
  text: string,
  width: number,
  firstIndent: number,
  measure: (value: string) => number,
): string[] {
  const lines: string[] = [];
  text.split("\n").forEach((paragraph, paragraphIndex) => {
    let line = "";
    const room = (): number =>
      width - (paragraphIndex === 0 && lines.length === 0 ? firstIndent : 0);
    for (const word of paragraph.split(/(?<=\s)/)) {
      if (line && measure(line + word.trimEnd()) > room()) {
        lines.push(line);
        line = "";
      }
      let rest = word;
      // A word wider than the box breaks anywhere (`wrap-break-word`).
      while (!line && rest && measure(rest.trimEnd()) > room()) {
        let end = rest.length - 1;
        while (end > 1 && measure(rest.slice(0, end)) > room()) end -= 1;
        lines.push(rest.slice(0, end));
        rest = rest.slice(end);
      }
      line += rest;
    }
    lines.push(line);
  });
  return lines;
}

/** Rasterize the old draft as `el` lays it out and scatter particles over its glyphs. */
function sampleText(
  text: string,
  el: HTMLElement,
  width: number,
  height: number,
): Particle[] {
  const style = getComputedStyle(el);
  const scale = Math.max(1, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.scale(scale, scale);
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.textBaseline = "alphabetic";
  const left = parseFloat(style.paddingLeft) || 0;
  const right = parseFloat(style.paddingRight) || 0;
  const top = parseFloat(style.paddingTop) || 0;
  const indent = parseFloat(style.textIndent) || 0;
  const lineHeight =
    parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 14) * 1.4;
  const lines = wrapLines(
    text,
    width - left - right,
    indent,
    (value) => ctx.measureText(value).width,
  );
  const metrics = ctx.measureText("Hg");
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent;
  const baseline =
    Number.isFinite(ascent) && Number.isFinite(descent)
      ? (lineHeight - (ascent + descent)) / 2 + ascent
      : lineHeight * 0.75;
  ctx.fillStyle = "#000";
  lines.forEach((line, index) => {
    const y = top + index * lineHeight;
    if (y > height) return;
    ctx.fillText(line, left + (index === 0 ? indent : 0), y + baseline);
  });

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const particles: Particle[] = [];
  for (let y = 0; y < height; y += STEP) {
    for (let x = 0; x < width; x += STEP) {
      const px = Math.floor(x * scale);
      const py = Math.floor(y * scale);
      const alpha = data[(py * canvas.width + px) * 4 + 3]! / 255;
      if (alpha < 0.25) continue;
      // A small, mostly forward and upward puff.
      const angle = -Math.PI / 2 + (Math.random() - 0.3) * Math.PI;
      const speed = 6 + Math.random() * 12;
      particles.push({
        x,
        y,
        alpha,
        vx: Math.cos(angle) * speed + 4,
        vy: Math.sin(angle) * speed * 0.8,
        life: PARTICLE_MS * (0.7 + Math.random() * 0.5),
      });
    }
  }
  if (particles.length <= MAX_PARTICLES) return particles;
  const keep = MAX_PARTICLES / particles.length;
  return particles.filter(() => Math.random() < keep);
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

function setMask(el: HTMLElement, mask: string): void {
  el.style.maskImage = mask;
  el.style.setProperty("-webkit-mask-image", mask);
}

/** Plays one sweep inside `layer`'s parent; returns a stop function. */
function playSweep(
  layer: HTMLElement,
  previous: string,
  textClassName: string,
  textIndent: string,
): (() => void) | null {
  const box = layer.parentElement;
  if (!box) return null;
  const width = box.clientWidth;
  const height = box.clientHeight;
  if (width === 0 || height === 0) return null;
  const scale = Math.max(1, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // The new text: every layer of the composer box except this one.
  const targets = Array.from(box.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child !== layer,
  );

  // The old draft stays real text until the edge passes it.
  const ghost = document.createElement("div");
  ghost.className = textClassName;
  ghost.style.textIndent = textIndent;
  ghost.textContent = previous;
  Object.assign(ghost.style, {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
  });
  layer.append(ghost);
  const particles = sampleText(previous, ghost, width, height);

  const canvasWidth = width + PAD * 2;
  const canvasHeight = height + PAD * 2;
  canvas.width = Math.ceil(canvasWidth * scale);
  canvas.height = Math.ceil(canvasHeight * scale);
  Object.assign(canvas.style, {
    position: "absolute",
    left: `${-PAD}px`,
    top: `${-PAD}px`,
    width: `${canvasWidth}px`,
    height: `${canvasHeight}px`,
    pointerEvents: "none",
  });
  ctx.scale(scale, scale);
  const color = getComputedStyle(ghost).color;
  layer.append(canvas);

  const travel = width + EDGE * 2;
  const edgeAt = (elapsed: number): number =>
    -EDGE + travel * easeInOut(clamp01(elapsed / SWEEP_MS));
  const reveal = (edge: number): void => {
    const shown = `linear-gradient(90deg, #000 ${edge - EDGE}px, transparent ${edge}px)`;
    for (const target of targets) setMask(target, shown);
    setMask(
      ghost,
      `linear-gradient(90deg, transparent ${edge - EDGE / 2}px, #000 ${edge + EDGE / 2}px)`,
    );
  };
  reveal(-EDGE);

  // Each particle leaves when the edge reaches it.
  const born = particles.map(() => -1);
  const start = performance.now();
  let frame = 0;
  const stop = (): void => {
    cancelAnimationFrame(frame);
    canvas.remove();
    ghost.remove();
    for (const target of targets) setMask(target, "");
  };

  const draw = (now: number): void => {
    const elapsed = now - start;
    const edge = edgeAt(elapsed);
    reveal(edge);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = color;
    let alive = false;
    particles.forEach((p, index) => {
      if (born[index]! < 0) {
        if (p.x > edge) {
          alive = true;
          return;
        }
        born[index] = elapsed;
      }
      const t = clamp01((elapsed - born[index]!) / p.life);
      if (t >= 1) return;
      alive = true;
      const drift = easeOut(t);
      ctx.globalAlpha = Math.min(1, p.alpha * 1.2) * (1 - t) ** 1.2;
      const size = 1.8 * (1 - t * 0.5);
      ctx.fillRect(
        PAD + p.x + p.vx * drift,
        PAD + p.y + p.vy * drift,
        size,
        size,
      );
    });
    ctx.globalAlpha = 1;
    if (alive || elapsed < SWEEP_MS) {
      frame = requestAnimationFrame(draw);
    } else {
      stop();
    }
  };
  frame = requestAnimationFrame(draw);
  return stop;
}

/**
 * Place inside the composer's `relative` text box, after the textarea.
 * `textClassName` and `textStyle` must match the text layers so the old
 * draft lines up with what was on screen.
 */
export function RewriteReveal({
  reveal,
  textClassName,
  textStyle,
}: {
  reveal: RewriteRevealEvent | null;
  textClassName: string;
  textStyle?: CSSProperties;
}): ReactNode {
  const layerRef = useRef<HTMLDivElement>(null);
  const indent = textStyle?.textIndent;

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!reveal || !layer || reducedMotion()) return;
    if (performance.now() - reveal.at > STALE_MS) return;
    const textIndent =
      indent === undefined
        ? ""
        : typeof indent === "number"
          ? `${indent}px`
          : indent;
    const stop = playSweep(layer, reveal.from, textClassName, textIndent);
    return () => stop?.();
    // Plays once per rewrite: a later class or indent change must not replay
    // it, so those are read when it starts and left out of the deps.
  }, [reveal]);

  return (
    <div
      ref={layerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0"
    />
  );
}
