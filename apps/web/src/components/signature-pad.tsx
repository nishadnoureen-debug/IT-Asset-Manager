'use client';

import { Eraser } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';

/**
 * Finger/mouse signature capture. Emits a PNG data URL (or null when cleared) via onChange.
 * Canvas is kept small so the upload stays well under the API's 512 KB limit.
 */
export function SignaturePad({
  onChange,
  label = 'Signature',
}: {
  onChange: (dataUrl: string | null) => void;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
  }, []);

  useEffect(() => {
    setup();
  }, [setup]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={empty}
          icon={<Eraser className="h-4 w-4" />}
        >
          Clear
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={`${label} pad — draw with your finger or mouse`}
        className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-slate-300 bg-white dark:border-slate-600"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = point(e);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const p = point(e);
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
          if (empty) setEmpty(false);
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
          if (!empty) onChange(canvasRef.current!.toDataURL('image/png'));
        }}
        onPointerLeave={() => {
          if (drawing.current && !empty) onChange(canvasRef.current!.toDataURL('image/png'));
          drawing.current = false;
        }}
      />
      <p className="mt-1 text-xs text-slate-500">
        {empty ? 'Sign above to acknowledge receipt.' : 'Signature captured.'}
      </p>
    </div>
  );
}
