"use client";
import { type RefObject } from "react";

/**
 * Solstice: the running state is a border-colour pulse driven by CSS
 * (`.node-card.node-generating` in globals.css, accent <-> border-2, 700ms yoyo).
 * The previous conic-gradient spotlight is gone (design rule: no gradients),
 * so this hook is kept only so call sites stay unchanged.
 */
export function useGeneratingBorderAnimation(
  _cardRef: RefObject<HTMLDivElement | null>,
  _busy: boolean,
) {
  /* no-op: CSS owns the animation */
}
