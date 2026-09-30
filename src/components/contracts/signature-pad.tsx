"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const W = 520;
const H = 150;

/** Draw-to-sign canvas (mouse, pen or touch). Reports a PNG data URL, or null when cleared. */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = 2;
    c.width = W * ratio;
    c.height = H * ratio;
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(ratio, ratio);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.lineWidth = 2.2;
    g.strokeStyle = "#0f172a";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (canvas.current) onChange(canvas.current.toDataURL("image/png"));
  };

  const clear = () => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    g.clearRect(0, 0, W, H);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="space-y-1.5">
      <div className="relative overflow-hidden rounded-md border border-input bg-white">
        <canvas
          ref={canvas}
          aria-label="Signature pad: draw your signature"
          role="img"
          className="block h-[150px] w-full cursor-crosshair touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            const p = point(e);
            last.current = p;
            const g = canvas.current?.getContext("2d");
            if (g) {
              g.beginPath();
              g.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
              g.fillStyle = "#0f172a";
              g.fill();
            }
            setEmpty(false);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || !last.current) return;
            const g = canvas.current?.getContext("2d");
            if (!g) return;
            const p = point(e);
            g.beginPath();
            g.moveTo(last.current.x, last.current.y);
            g.lineTo(p.x, p.y);
            g.stroke();
            last.current = p;
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
          onPointerLeave={finish}
        />
        <div className="pointer-events-none absolute right-4 bottom-8 left-4 border-b border-dashed border-slate-300" aria-hidden />
        {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Sign here</span>}
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={empty}>
          Clear
        </Button>
      </div>
    </div>
  );
}
