import { useGLTF } from "@react-three/drei";
import { Component, Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { requestPropThumb } from "./thumbRenderer";

/**
 * Lazy 3D snapshot for a palette row. The GLB is only fetched once the chip
 * is near the scrollport, and rendering goes through the shared thumbnail
 * context so opening a category does not spawn dozens of WebGL canvases.
 */

class ThumbErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function PropThumbScene({ url, canvasRef }: { url: string; canvasRef: RefObject<HTMLCanvasElement | null> }) {
  const gltf = useGLTF(url);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return requestPropThumb(url, gltf.scene, canvas);
  }, [url, gltf.scene, canvasRef]);
  return null;
}

export function PropThumb({ url, label }: { url: string; label?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: "180px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="prop-thumb" aria-hidden title={label}>
      <canvas ref={canvasRef} width={96} height={96} />
      {near && (
        <ThumbErrorBoundary>
          <Suspense fallback={null}>
            <PropThumbScene url={url} canvasRef={canvasRef} />
          </Suspense>
        </ThumbErrorBoundary>
      )}
    </div>
  );
}
