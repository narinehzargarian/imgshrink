import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, createZip, uniqueNames } from "../../src/zip";

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("uniqueNames", () => {
  it("numbers repeated names, ignoring case", () => {
    expect(uniqueNames(["a.jpg", "b.jpg", "A.jpg", "a.jpg"])).toEqual(["a.jpg", "b.jpg", "A (2).jpg", "a (3).jpg"]);
    expect(uniqueNames(["noext", "noext"])).toEqual(["noext", "noext (2)"]);
  });
});

describe("createZip", () => {
  // Checked with the system's own unzip tool, not by reading our output back with our code.
  it("produces a zip that unzip lists and verifies", () => {
    const dir = mkdtempSync(join(tmpdir(), "imgshrink-zip-"));
    const path = join(dir, "out.zip");
    const bytes = new Uint8Array(5000).map((_, i) => (i * 31) % 256);
    writeFileSync(
      path,
      createZip(
        [
          { name: "photo.jpg", data: bytes },
          { name: "photo.jpg", data: new TextEncoder().encode("second") },
          { name: "café ☕.png", data: new Uint8Array([1, 2, 3]) },
        ],
        new Date(2026, 10, 2, 14, 30, 10),
      ),
    );
    // Names are checked with Python's zip reader, which honors the UTF-8 flag. (The unzip that
    // ships with macOS is built without Unicode support and garbles non-ASCII names; Finder
    // and Windows read them correctly.)
    const names = execFileSync("python3", ["-c", "import json,sys,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))", path], { encoding: "utf8" });
    expect(JSON.parse(names)).toEqual(["photo.jpg", "photo (2).jpg", "café ☕.png"]);
    expect(execFileSync("unzip", ["-t", path], { encoding: "utf8" })).toContain("No errors detected");
    expect(execFileSync("unzip", ["-p", path, "photo (2).jpg"], { encoding: "utf8" })).toBe("second");
  });

  it("handles an empty list", () => {
    expect(createZip([]).length).toBe(22);
  });
});
