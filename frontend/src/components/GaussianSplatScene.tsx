import { useEffect } from 'react';

interface Props {
  url: string;
  onLoad?: () => void;
  onError?: (e: unknown) => void;
}

/**
 * Bridges the R3F Canvas to the @mkkellogg/gaussian-splats-3d viewer in #splat-root.
 * Fires onLoad when the GS3D viewer signals the splat is ready. Renders nothing into
 * the R3F scene — GS3D owns its own canvas and handles all splat rendering.
 *
 * DroneScanner captures images by temporarily repositioning window.gsplatViewer.camera
 * and reading from window.gsplatViewer.renderer.domElement.
 */
export function GaussianSplatScene({ onLoad, onError }: Props) {
  useEffect(() => {
    if ((window as any)._splatLoaded) {
      onLoad?.();
      return;
    }
    const handleLoad = () => onLoad?.();
    const handleError = () => onError?.(new Error('Splat load error'));
    window.addEventListener('splat:loaded', handleLoad);
    window.addEventListener('splat:error', handleError);
    return () => {
      window.removeEventListener('splat:loaded', handleLoad);
      window.removeEventListener('splat:error', handleError);
    };
  }, [onLoad, onError]);

  return null;
}
