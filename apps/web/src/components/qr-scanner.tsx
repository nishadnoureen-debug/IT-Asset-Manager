'use client';

import { CameraOff, Keyboard } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/form';

type ScannerState = 'starting' | 'scanning' | 'unavailable';

/**
 * Camera QR/barcode scanner with manual entry fallback. Calls onDetect once per distinct code;
 * the camera needs HTTPS or localhost.
 */
export function QrScanner({
  onDetect,
  paused = false,
}: {
  onDetect: (code: string) => void;
  paused?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScannerState>('starting');
  const [reason, setReason] = useState<string>('');
  const [manual, setManual] = useState('');
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let controls: { stop: () => void } | undefined;
    let cancelled = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unavailable');
        setReason(
          window.isSecureContext
            ? 'This browser cannot access the camera.'
            : 'The camera needs a secure (HTTPS) connection.',
        );
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current!,
          (result) => {
            if (!result || pausedRef.current) return;
            const code = result.getText();
            const now = Date.now();
            // Ignore the same code for 3 s so a steady camera doesn't fire repeatedly.
            if (
              lastCode.current &&
              lastCode.current.code === code &&
              now - lastCode.current.at < 3000
            )
              return;
            lastCode.current = { code, at: now };
            navigator.vibrate?.(60);
            onDetectRef.current(code);
          },
        );
        if (cancelled) controls.stop();
        else setState('scanning');
      } catch (error) {
        if (cancelled) return;
        setState('unavailable');
        const name = (error as Error)?.name;
        setReason(
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in your browser settings.'
            : name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : 'The camera could not be started.',
        );
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-900 sm:aspect-video">
        {state !== 'unavailable' ? (
          <>
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              aria-label="Camera preview"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-3/5 w-3/5 max-w-xs rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] sm:h-2/3 sm:w-auto sm:aspect-square" />
            </div>
            {state === 'starting' && (
              <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white/90">
                Starting camera…
              </p>
            )}
            {paused && (
              <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white/90">
                Paused
              </p>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-300">
            <CameraOff className="h-8 w-8" aria-hidden />
            <p className="text-sm">{reason}</p>
            <p className="text-xs text-slate-400">
              Type or paste the asset tag, serial number or QR link below.
            </p>
          </div>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            onDetect(manual.trim());
            setManual('');
          }
        }}
      >
        <label htmlFor="manual-code" className="sr-only">
          Asset tag, serial number or QR link
        </label>
        <Input
          id="manual-code"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Asset tag, serial or QR link"
          autoComplete="off"
        />
        <Button type="submit" variant="secondary" icon={<Keyboard className="h-4 w-4" />}>
          Look up
        </Button>
      </form>
    </div>
  );
}
