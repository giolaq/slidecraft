import sharp from "sharp";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
export async function importPhoto(source: string): Promise<string> {
  let bytes: Buffer;
  if (/^data:image\/(png|jpeg|webp|gif);base64,/.test(source)) {
    bytes = Buffer.from(source.split(",")[1], "base64");
  } else {
    let url = new URL(source);
    let downloaded: Buffer | undefined;
    for (let hop = 0; hop < 5; hop++) {
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        (url.port && url.port !== "443")
      )
        throw new Error("Use a public HTTPS image URL without credentials.");
      const addresses = await lookup(url.hostname, { all: true });
      if (
        !addresses.length ||
        addresses.some((a) => ipaddr.process(a.address).range() !== "unicast")
      )
        throw new Error(
          "Private and reserved network addresses are not allowed.",
        );
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location)
          throw new Error("Image redirect is missing its destination.");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `Image download failed (${response.status}). Use a direct image URL, not a web page.`,
        );
      }
      if (
        !/^image\/(jpeg|png|webp|gif)(;|$)/i.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        await response.body?.cancel();
        throw new Error(
          "The URL must return a JPEG, PNG, WebP, or GIF image, not HTML.",
        );
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (response.body)
        for await (const chunk of response.body) {
          length += chunk.length;
          if (length > 8_000_000)
            throw new Error("Image download exceeds 8 MB.");
          chunks.push(chunk);
        }
      downloaded = Buffer.concat(chunks);
      break;
    }
    if (!downloaded) throw new Error("Too many image redirects.");
    bytes = downloaded;
  }
  if (bytes.length > 8_000_000) throw new Error("Image exceeds 8 MB.");
  const metadata = await sharp(bytes, {
    limitInputPixels: 40_000_000,
    animated: false,
  }).metadata();
  if (!["jpeg", "png", "webp", "gif"].includes(metadata.format ?? ""))
    throw new Error("The supplied bytes are not a supported photo format.");
  let output: Buffer | undefined;
  for (const width of [1400, 1000, 700, 450]) {
    output = await sharp(bytes, {
      limitInputPixels: 40_000_000,
      animated: false,
    })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    if (output.length <= 120_000) break;
  }
  if (!output || output.length > 120_000)
    throw new Error("This image is too complex to embed. Use a smaller image.");
  return `data:image/webp;base64,${output.toString("base64")}`;
}
