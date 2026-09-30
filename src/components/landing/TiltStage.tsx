"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Panggung 3D yang miring mengikuti penunjuk.
 *
 * Hanya menulis dua variabel CSS (--rx, --ry) di elemen luarnya; seluruh gambarnya —
 * perspektif, `preserve-3d`, kedalaman tiap lapisan — ada di globals.css (`.stage-3d`).
 * Jadi yang dikerjakan JavaScript di sini satu hal kecil per frame, lewat
 * requestAnimationFrame, dan hanya saat panggungnya terlihat.
 *
 * Mati dengan sengaja pada dua keadaan, dan panggungnya tetap tampil diam:
 *   - `pointer: coarse` (layar sentuh): tidak ada penunjuk yang melayang untuk diikuti,
 *     dan memiringkan mengikuti jari yang menggulir terasa seperti halaman yang goyah.
 *   - `prefers-reduced-motion: reduce`: gerak dekoratif dimatikan, sama seperti paralaks.
 */
export default function TiltStage({
  children,
  className = "",
  max = 7,
}: {
  children: ReactNode;
  className?: string;
  /** Kemiringan maksimum dalam derajat. */
  max?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let visible = true;
    let rx = 0;
    let ry = 0;

    const apply = () => {
      raf = 0;
      el.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
      el.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const reset = () => {
      rx = 0;
      ry = 0;
      el.dataset.tilting = "false";
      schedule();
    };
    const onMove = (ev: PointerEvent) => {
      if (!visible) return;
      const r = el.getBoundingClientRect();
      // Posisi relatif terhadap pusat panggung, dinormalkan ke setengah viewport: penunjuk
      // di mana pun di layar pertama menggerakkannya, bukan hanya di atas robotnya.
      const nx = (ev.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
      const ny = (ev.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
      ry = Math.max(-1, Math.min(1, nx)) * max;
      rx = Math.max(-1, Math.min(1, ny)) * -max;
      el.dataset.tilting = "true";
      schedule();
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) reset();
    });
    io.observe(el);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    return () => {
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", reset);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [max]);

  return (
    <div ref={outer} className={`stage-3d ${className}`}>
      <div className="stage-3d__inner relative flex h-full w-full items-center justify-center">{children}</div>
    </div>
  );
}
