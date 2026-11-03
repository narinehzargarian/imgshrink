// Builds a .zip in the browser for "Download all". Files are stored without compression:
// JPEG and PNG are already compressed, so zipping them again only costs time.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Makes names unique within the zip: photo.jpg, photo (2).jpg, photo (3).jpg. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    const candidate = dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
    seen.set(candidate.toLowerCase(), 1);
    return candidate;
  });
}

// The zip format stores dates in MS-DOS form.
function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(now);
  const names = uniqueNames(entries.map((e) => e.name)).map((n) => encoder.encode(n));

  let size = 22;
  entries.forEach((e, i) => (size += 30 + names[i]!.length + e.data.length + 46 + names[i]!.length));
  if (size > 0xffffffff || entries.length > 0xffff) throw new Error("Too much data for one zip file");

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;
  const central: { offset: number; crc: number; name: Uint8Array; size: number }[] = [];

  entries.forEach((entry, i) => {
    const name = names[i]!;
    const crc = crc32(entry.data);
    central.push({ offset, crc, name, size: entry.data.length });
    view.setUint32(offset, 0x04034b50, true); // local file header
    view.setUint16(offset + 4, 20, true); // version needed
    view.setUint16(offset + 6, 0x0800, true); // flags: names are UTF-8
    view.setUint16(offset + 8, 0, true); // stored, no compression
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, day, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, name.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(name, offset + 30);
    out.set(entry.data, offset + 30 + name.length);
    offset += 30 + name.length + entry.data.length;
  });

  const centralStart = offset;
  for (const c of central) {
    view.setUint32(offset, 0x02014b50, true); // central directory header
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, time, true);
    view.setUint16(offset + 14, day, true);
    view.setUint32(offset + 16, c.crc, true);
    view.setUint32(offset + 20, c.size, true);
    view.setUint32(offset + 24, c.size, true);
    view.setUint16(offset + 28, c.name.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, c.offset, true);
    out.set(c.name, offset + 46);
    offset += 46 + c.name.length;
  }

  view.setUint32(offset, 0x06054b50, true); // end of central directory
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, central.length, true);
  view.setUint16(offset + 10, central.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true);
  return out;
}
