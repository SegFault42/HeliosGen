"use client";
import { useEffect, useRef } from "react";

interface Pixel {
  x: number;
  y: number;
  phase: number;
  speed: number;
}

export default function DotCanvasBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let pixels: Pixel[] = [];

    function resize() {
      if (!canvas || !ctx) return;
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      spawnPixels();
    }

    function spawnPixels() {
      if (!canvas) return;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const gap = 16;
      pixels = [];
      for (let x = gap; x < w; x += gap) {
        for (let y = gap; y < h; y += gap) {
          if (Math.random() > 0.75) continue;
          pixels.push({
            x,
            y,
            phase: Math.random() * Math.PI * 2,
            speed: 0.018 + Math.random() * 0.025,
          });
        }
      }
    }

    let t = 0;
    function draw() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
      t += 1;
      for (const p of pixels) {
        const alpha = (Math.sin(p.phase + t * p.speed) + 1) / 2;
        const a = alpha * 0.35;
        if (a < 0.01) continue;
        ctx.fillStyle = `rgba(45,212,191,${a})`;
        ctx.fillRect(p.x, p.y, 1.5, 1.5);
      }
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none block size-full"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
