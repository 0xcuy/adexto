"use client";

import { useEffect, useRef } from "react";

/**
 * Percikan violet yang naik pelan di belakang hero.
 *
 * Batas yang dijaga, karena latar beranimasi pernah dicabut dari situs ini (runbook §4c-ter):
 *   - HANYA di hero halaman depan, tidak pernah di halaman trading.
 *   - Paling banyak 56 partikel, canvas 2D biasa, tanpa three.js.
 *   - Berhenti total saat tab tersembunyi atau hero keluar layar.
 *   - `prefers-reduced-motion` → satu frame statis, tanpa loop.
 */
export default function HeroSparks({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;
    let visible = true;

    type P = { x: number; y: number; r: number; vy: number; vx: number; a: number; tw: number };
    let parts: P[] = [];

    const spawn = (anywhere: boolean): P => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 10,
      r: 0.6 + Math.random() * 2.2,
      vy: 0.12 + Math.random() * 0.45,
      vx: (Math.random() - 0.5) * 0.18,
      a: 0.25 + Math.random() * 0.6,
      tw: Math.random() * Math.PI * 2,
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(56, Math.round((w * h) / 22000));
      parts = Array.from({ length: count }, () => spawn(true));
    };

    const color = () =>
      document.documentElement.getAttribute("data-theme") === "light" ? "124, 58, 237" : "176, 142, 255";

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const rgb = color();
      for (const p of parts) {
        p.y -= p.vy;
        p.x += p.vx;
        p.tw += 0.03;
        if (p.y < -10) Object.assign(p, spawn(false));
        const alpha = p.a * (0.6 + 0.4 * Math.sin(p.tw)) * Math.min(1, p.y / (h * 0.25));
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
        g.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = () => {
      draw();
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    };

    resize();
    if (reduce) {
      draw();
      return;
    }
    raf = requestAnimationFrame(loop);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    });
    io.observe(canvas);
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none ${className}`} />;
}
