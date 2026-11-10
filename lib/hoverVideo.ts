import type { MouseEvent } from "react";

/**
 * Spread on any element that contains a <video>: the clip plays while the
 * pointer is over the element and rests on its first frame otherwise.
 * Used for small previews; the video nodes run their own player logic.
 */
export const hoverVideoHandlers = {
  onMouseEnter: (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.querySelector("video")?.play().catch(() => {});
  },
  onMouseLeave: (e: MouseEvent<HTMLElement>) => {
    const v = e.currentTarget.querySelector("video");
    if (v) { v.pause(); v.currentTime = 0; }
  },
};
