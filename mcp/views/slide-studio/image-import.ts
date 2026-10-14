const MAX_IMAGE_URL_LENGTH = 180000;

// Safari may silently return PNG when canvas cannot encode WebP. Check the
// actual MIME type, and keep reducing dimensions for lossless fallback images.
export async function readImage(file: File): Promise<string> {
  if (
    !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
    file.size > 8 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPEG, WebP or GIF under 8 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error("Choose an image under 40 megapixels.");
    for (const width of [1600, 1200, 900, 640, 450, 320, 224, 160]) {
      const canvas = document.createElement("canvas");
      const ratio = Math.min(1, width / bitmap.width, width / bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("Image processing is unavailable in this browser.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let fallback = false;
      for (const quality of [0.85, 0.7, 0.5]) {
        const src = canvas.toDataURL("image/webp", quality);
        if (
          /^data:image\/(webp|png);base64,/.test(src) &&
          src.length <= MAX_IMAGE_URL_LENGTH
        )
          return src;
        if (!src.startsWith("data:image/webp;")) {
          fallback = true;
          break;
        }
      }
      if (fallback) {
        // JPEG retains resolution on browsers without WebP encoding, but must
        // never flatten a transparent logo or illustration against black.
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let transparent = false;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] !== 255) {
            transparent = true;
            break;
          }
        }
        if (!transparent) {
          for (const quality of [0.85, 0.7, 0.5]) {
            const src = canvas.toDataURL("image/jpeg", quality);
            if (
              src.startsWith("data:image/jpeg;base64,") &&
              src.length <= MAX_IMAGE_URL_LENGTH
            )
              return src;
          }
        }
      }
    }
    throw new Error(
      "This browser could not compress the image. Try exporting it as JPEG or PNG and upload it again.",
    );
  } finally {
    bitmap.close();
  }
}
