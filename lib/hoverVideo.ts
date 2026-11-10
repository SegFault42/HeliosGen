import type { MouseEvent } from "react";

/**
 * Spread on any element that contains <video>s: they play while the pointer
 * is over the element and rest on their first frame otherwise.
 * Used for small previews; the video nodes run their own player logic.
 */
export const hoverVideoHandlers = {
  onMouseEnter: (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.querySelectorAll("video").forEach((v) => { v.play().catch(() => {}); });
  },
  onMouseLeave: (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.querySelectorAll("video").forEach((v) => { v.pause(); v.currentTime = 0; });
  },
};
