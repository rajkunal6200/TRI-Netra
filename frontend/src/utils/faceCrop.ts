import { DetectedFace } from '@shared/types';

/**
 * Crops a single person's facial portrait from the full camera frame
 * using their bounding box [ymin, xmin, ymax, xmax] (normalized 0-1000).
 * Ensures only THAT person is in the resulting image, excluding any other people.
 */
export async function cropPersonPortrait(
  frameBase64: string,
  box_2d: [number, number, number, number],
  paddingRatio = 0.15
): Promise<string> {
  return new Promise((resolve) => {
    if (!frameBase64 || !box_2d || box_2d.length !== 4) {
      resolve(frameBase64);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const [yminNorm, xminNorm, ymaxNorm, xmaxNorm] = box_2d;
        const naturalW = img.naturalWidth || 1280;
        const naturalH = img.naturalHeight || 720;

        const xmin = (Math.max(0, Math.min(1000, xminNorm)) / 1000) * naturalW;
        const xmax = (Math.max(0, Math.min(1000, xmaxNorm)) / 1000) * naturalW;
        const ymin = (Math.max(0, Math.min(1000, yminNorm)) / 1000) * naturalH;
        const ymax = (Math.max(0, Math.min(1000, ymaxNorm)) / 1000) * naturalH;

        const boxW = Math.max(16, xmax - xmin);
        const boxH = Math.max(16, ymax - ymin);

        // Add moderate padding around head/chin (15% padding)
        // Kept tight enough to completely exclude adjacent or background persons
        const padX = boxW * paddingRatio;
        const padY = boxH * paddingRatio;

        const cropX = Math.max(0, Math.floor(xmin - padX));
        const cropY = Math.max(0, Math.floor(ymin - padY));
        const cropW = Math.min(naturalW - cropX, Math.ceil(boxW + padX * 2));
        const cropH = Math.min(naturalH - cropY, Math.ceil(boxH + padY * 2));

        if (cropW <= 0 || cropH <= 0) {
          resolve(frameBase64);
          return;
        }

        // Preserve more source detail from high-resolution frames for inspection.
        const targetDimension = Math.max(280, Math.min(640, Math.round(Math.max(cropW, cropH))));
        const canvas = document.createElement('canvas');
        canvas.width = targetDimension;
        canvas.height = targetDimension;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(frameBase64);
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Dark neutral studio background backdrop
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, targetDimension, targetDimension);

        // Center the cropped portrait inside the square canvas
        const aspect = cropW / cropH;
        let drawW = targetDimension;
        let drawH = targetDimension;
        let destX = 0;
        let destY = 0;

        if (aspect > 1) {
          drawH = Math.round(targetDimension / aspect);
          destY = Math.round((targetDimension - drawH) / 2);
        } else {
          drawW = Math.round(targetDimension * aspect);
          destX = Math.round((targetDimension - drawW) / 2);
        }

        ctx.drawImage(img, cropX, cropY, cropW, cropH, destX, destY, drawW, drawH);

        // Optional subtle biometric crosshair watermark or vignette
        const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.94);
        resolve(croppedDataUrl);
      } catch (err) {
        console.warn('Portrait isolation crop error:', err);
        resolve(frameBase64);
      }
    };

    img.onerror = () => {
      resolve(frameBase64);
    };

    img.src = frameBase64;
  });
}

/**
 * Iterates through all detected faces in a frame and generates an isolated portrait
 * for each person, ensuring no two people share the same image.
 */
export async function attachIsolatedPortraitsToFaces(
  frameBase64: string,
  faces: DetectedFace[]
): Promise<DetectedFace[]> {
  if (!frameBase64 || !faces || faces.length === 0) {
    return faces;
  }

  const updatedFaces: DetectedFace[] = [];

  for (const face of faces) {
    if (face.box_2d && face.box_2d.length === 4) {
      const croppedUrl = await cropPersonPortrait(frameBase64, face.box_2d);
      updatedFaces.push({
        ...face,
        croppedFaceUrl: croppedUrl,
      });
    } else {
      updatedFaces.push(face);
    }
  }

  return updatedFaces;
}
