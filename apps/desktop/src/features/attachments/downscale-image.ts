/** Anthropic's recommended max long edge; bigger only costs tokens. */
export const MAX_DIMENSION = 1568;
export const JPEG_QUALITY = 0.85;

/**
 * Downscale an image file before upload. GIFs pass through (resizing would
 * drop animation); decode failures fall back to the original file — the
 * server enforces the hard 5MB cap either way.
 */
export async function downscaleImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_DIMENSION) {
      bitmap.close();
      return file;
    }
    const scale = MAX_DIMENSION / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob) return file;
    const jpegName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], jpegName, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
