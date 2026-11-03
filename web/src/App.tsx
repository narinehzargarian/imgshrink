import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, formatChange, outputName } from "./format";
import { COLOR_CHOICES, DEFAULT_OPTIONS, mimeType, normalizeOptions, SIZE_CHOICES, type Format, type Options } from "./options";
import { WorkerPool } from "./pool";
import { createZip } from "./zip";

interface Output {
  blob: Blob;
  url: string;
  name: string;
  width: number;
  height: number;
  /** True when the original was already smaller, so it's offered unchanged. */
  kept: boolean;
}

interface Item {
  id: number;
  file: File;
  status: "working" | "done" | "error";
  output?: Output;
  original?: { width: number; height: number };
  error?: string;
}

const STORAGE_KEY = "imgshrink-options";

function loadOptions(): Options {
  try {
    return normalizeOptions(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function saveOptions(options: Options): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Private windows can block storage; settings then last only for this visit.
  }
}

const FORMAT_LABELS: { value: Format; label: string; hint: string }[] = [
  { value: "jpeg", label: "JPEG", hint: "Best for photos" },
  { value: "png", label: "PNG", hint: "Lossless, keeps transparency" },
  { value: "png-palette", label: "PNG, fewer colors", hint: "Much smaller PNGs for logos, screenshots, and graphics" },
];

export function App() {
  const pool = useMemo(() => new WorkerPool(), []);
  const [ready, setReady] = useState(false);
  const [options, setOptions] = useState<Options>(loadOptions);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const generation = useRef(0);
  const nextId = useRef(1);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    pool.ready.then((workerUrls) => {
      setReady(true);
      // Offline support: cache this page's files and the workers' files. Only in the built site.
      if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
      navigator.serviceWorker
        .register("./sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then((registration) => {
          const pageUrls = performance.getEntriesByType("resource").map((entry) => entry.name);
          registration.active?.postMessage({ type: "cache", urls: [location.href, ...pageUrls, ...workerUrls] });
        })
        .catch(() => {});
    });
  }, [pool]);

  const process = useCallback(
    async (item: Item, opts: Options, gen: number) => {
      const result = await pool.process(item.file, opts);
      if (gen !== generation.current) return; // settings changed meanwhile
      setItems((current) =>
        current.map((it) => {
          if (it.id !== item.id) return it;
          if (!result.ok) return { ...it, status: "error", error: result.error };
          const name = outputName(item.file.name, opts.format);
          const sameSize = result.width === result.originalWidth && result.height === result.originalHeight;
          // Re-encoding an already well-compressed file can make it bigger. If nothing else
          // changed, offer the original instead.
          if (sameSize && item.file.type === mimeType(opts.format) && result.bytes.byteLength >= item.file.size) {
            const output: Output = { blob: item.file, url: URL.createObjectURL(item.file), name: item.file.name, width: result.width, height: result.height, kept: true };
            return { ...it, status: "done", output, original: { width: result.originalWidth, height: result.originalHeight } };
          }
          const blob = new Blob([result.bytes], { type: result.type });
          const output: Output = { blob, url: URL.createObjectURL(blob), name, width: result.width, height: result.height, kept: false };
          return { ...it, status: "done", output, original: { width: result.originalWidth, height: result.originalHeight } };
        }),
      );
    },
    [pool],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const added: Item[] = [...files].map((file) => ({ id: nextId.current++, file, status: "working" }));
      if (!added.length) return;
      setItems((current) => [...current, ...added]);
      for (const item of added) void process(item, options, generation.current);
    },
    [options, process],
  );

  // Changing a setting redoes every image with the new settings.
  const changeOptions = (change: Partial<Options>) => {
    const next = normalizeOptions({ ...options, ...change });
    setOptions(next);
    saveOptions(next);
    generation.current++;
    pool.clearQueue();
    const gen = generation.current;
    const redo = itemsRef.current.map((it): Item => {
      if (it.output) URL.revokeObjectURL(it.output.url);
      return { id: it.id, file: it.file, status: "working" };
    });
    setItems(redo);
    for (const item of redo) void process(item, next, gen);
  };

  const clear = () => {
    generation.current++;
    pool.clearQueue();
    for (const it of items) if (it.output) URL.revokeObjectURL(it.output.url);
    setItems([]);
  };

  const remove = (id: number) => {
    setItems((current) =>
      current.filter((it) => {
        if (it.id === id && it.output) URL.revokeObjectURL(it.output.url);
        return it.id !== id;
      }),
    );
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const done = items.filter((it) => it.status === "done" && it.output);
  const working = items.filter((it) => it.status === "working").length;
  const before = done.reduce((sum, it) => sum + it.file.size, 0);
  const after = done.reduce((sum, it) => sum + it.output!.blob.size, 0);

  const downloadAll = async () => {
    const entries = await Promise.all(done.map(async (it) => ({ name: it.output!.name, data: new Uint8Array(await it.output!.blob.arrayBuffer()) })));
    const url = URL.createObjectURL(new Blob([createZip(entries)], { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "imgshrink.zip";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <main data-engine={ready ? "ready" : "loading"}>
      <header>
        <h1>imgshrink</h1>
        <p className="lead">Resize and compress photos in your browser. Nothing is uploaded: your images never leave this device.</p>
      </header>

      <section className="settings" aria-label="Settings">
        <fieldset className="formats">
          <legend>Save as</legend>
          {FORMAT_LABELS.map((f) => (
            <label key={f.value} className={options.format === f.value ? "chip selected" : "chip"} title={f.hint}>
              <input type="radio" name="format" value={f.value} checked={options.format === f.value} onChange={() => changeOptions({ format: f.value })} />
              {f.label}
            </label>
          ))}
        </fieldset>

        <label className="field">
          <span>Longest side</span>
          <select value={options.maxSide} onChange={(e) => changeOptions({ maxSide: Number(e.target.value) })}>
            {SIZE_CHOICES.map((size) => (
              <option key={size} value={size}>
                {size === 0 ? "Keep original size" : `Up to ${size} px`}
              </option>
            ))}
          </select>
        </label>

        {options.format === "jpeg" && (
          <label className="field">
            <span>Quality: {options.quality}</span>
            <input type="range" min={40} max={95} value={options.quality} onChange={(e) => changeOptions({ quality: Number(e.target.value) })} />
          </label>
        )}

        {options.format === "png-palette" && (
          <>
            <label className="field">
              <span>Colors</span>
              <select value={options.colors} onChange={(e) => changeOptions({ colors: Number(e.target.value) })}>
                {COLOR_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field inline">
              <input type="checkbox" checked={options.dither} onChange={(e) => changeOptions({ dither: e.target.checked })} />
              <span>Smooth gradients (dithering)</span>
            </label>
          </>
        )}
      </section>

      <label
        className={dragging ? "drop dragging" : "drop"}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <strong>Drop photos here, or click to choose</strong>
        <span>JPEG, PNG, WebP, GIF, and more. You can also paste an image.</span>
      </label>

      {items.length > 0 && (
        <section aria-label="Results">
          <div className="summary">
            <span role="status">
              {working > 0
                ? `Working on ${working} of ${items.length}...`
                : `${done.length} done: ${formatBytes(before)} → ${formatBytes(after)} (${formatChange(before, after)})`}
            </span>
            <span className="actions">
              <button type="button" className="primary" disabled={!done.length || working > 0} onClick={downloadAll}>
                Download all (.zip)
              </button>
              <button type="button" onClick={clear}>
                Clear
              </button>
            </span>
          </div>

          <ul className="results">
            {items.map((it) => (
              <li key={it.id} data-testid="result" data-status={it.status}>
                <div className="thumb">{it.output && <img src={it.output.url} alt="" />}</div>
                <div className="info">
                  <span className="name">{it.output?.name ?? it.file.name}</span>
                  {it.status === "working" && <span className="muted">Working...</span>}
                  {it.status === "error" && <span className="error">{it.error}</span>}
                  {it.status === "done" && it.output && (
                    <span className="muted">
                      {formatBytes(it.file.size)} → <span data-testid="new-size">{formatBytes(it.output.blob.size)}</span>{" "}
                      <span className={it.output.blob.size < it.file.size ? "saved" : "grew"}>{formatChange(it.file.size, it.output.blob.size)}</span>
                      {" · "}
                      <span data-testid="dimensions">
                        {it.output.width} × {it.output.height}
                      </span>
                      {it.output.kept && " · Already well compressed, original kept"}
                      {!it.output.kept && it.output.blob.size > it.file.size && " · Larger than the original; try another format"}
                    </span>
                  )}
                </div>
                <div className="row-actions">
                  {it.output && (
                    <a className="button" href={it.output.url} download={it.output.name}>
                      Download
                    </a>
                  )}
                  <button type="button" aria-label={`Remove ${it.file.name}`} onClick={() => remove(it.id)}>
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer>
        <a href="https://github.com/narinehzargarian/imgshrink" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
        . Image processing runs in C++ compiled to WebAssembly, on your device.
      </footer>
    </main>
  );
}
