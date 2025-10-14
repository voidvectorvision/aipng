"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

const MAX_FILES = 8;
const fileOk = (f: File) =>
  f.type.startsWith("image/") && f.size <= 10 * 1024 * 1024;

const schema = z.object({
  prompt: z.string().min(1, "请输入提示词").max(1000),
  key: z.string().optional(),
});

type Img = { name: string; url: string };
type Run = { id: string; ts: string; durSec: number; url: string };

export default function Page() {
  const [prompt, setPrompt] = useState("");
  const [key, setKey] = useState<string>();
  const [batchSize, setBatchSize] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("就绪");
  const [imgs, setImgs] = useState<Img[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ open: boolean; idx: number }>({
    open: false,
    idx: 0,
  });
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const savedRuns = localStorage.getItem("runs");
    if (savedRuns) {
      setRuns(JSON.parse(savedRuns));
    }
  }, []);

  // ---- 伪进度逻辑 ----
  useEffect(() => {
    if (!busy) return setProgress(0);
    let pct = 0;
    const step = 100 / (14 * 10 * batchSize); // 每100ms一次，14秒到99%
    const timer = setInterval(() => {
      pct += step;
      setProgress((p) => Math.min(pct, 99));
    }, 100);
    return () => clearInterval(timer);
  }, [busy]);

  function openPreview(idx: number) {
    setPreview({ open: true, idx });
  }
  function closePreview() {
    setPreview((s) => ({ ...s, open: false }));
  }
  function prevImg() {
    setPreview((s) => ({ ...s, idx: (s.idx - 1 + runs.length) % runs.length }));
  }
  function nextImg() {
    setPreview((s) => ({ ...s, idx: (s.idx + 1) % runs.length }));
  }

  function toast(s: string) {
    setStatus(s);
    setTimeout(() => setStatus("就绪"), 1600);
  }

  function downloadImage(url: string, filename = "image") {
    if (url.startsWith("data:") || url.startsWith("blob:")) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.replace(/\. +$/, "");
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    window.open(url, "_blank");
  }

  async function downscaleDataURL(
    dataURL: string,
    maxSide = 2048,
    quality = 0.82
  ): Promise<string> {
    const img = new window.Image();
    img.src = dataURL;
    await img.decode();
    let { width: w, height: h } = img;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    if (scale === 1) return dataURL;
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  }

  function extractDataUris(t: string): string[] {
    return (t.match(
      /data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\-_]+/g
    ) || []) as string[];
  }

  function extractImageUrlsFromText(t: string): string[] {
    if (!t) return [];
    const out: string[] = [];
    const md = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = md.exec(t))) out.push(m[1]);
    const re = /(https?:\/\/[^\s\)\]\}<'">,，。；、]+)/gi;
    let m2: RegExpExecArray | null;
    while ((m2 = re.exec(t))) out.push(m2[1].replace(/[>,，。；、]+$/, ""));
    return Array.from(new Set(out));
  }

  async function onFiles(files?: FileList | null) {
    const arr = Array.from(files || []).filter(fileOk);
    if (!arr.length) return;
    if (imgs.length + arr.length > MAX_FILES) return toast("最多 8 张");
    const added: Img[] = [];
    for (const f of arr) {
      const b64 = await fileToDataURL(f);
      const down = await downscaleDataURL(b64, 2048, 0.82);
      added.push({ name: f.name, url: down });
    }
    setImgs((s) => [...s, ...added]);
  }

  function removeAt(i: number) {
    setImgs((s) => s.filter((_, idx) => idx !== i));
  }

  function removeRun(id: string) {
    setRuns((s) => {
      const newRuns = s.filter((r) => r.id !== id);
      localStorage.setItem("runs", JSON.stringify(newRuns));
      return newRuns;
    });
  }

  async function generate() {
    const check = schema.safeParse({ prompt, key: key?.trim() });
    if (!check.success) return toast(check.error.issues[0].message);
    const _key = key?.trim() || process.env.NEXT_PUBLIC_PUBLISHABLE_KEY || "";
    if (!_key) return toast("缺少 Key");

    setBusy(true);
    setStatus(`正在生成 ${batchSize} 张图片...`);

    const promises = Array.from({ length: batchSize }, () => doGenerate(_key));

    try {
      await Promise.all(promises);
      toast(`完成：${batchSize} 张`);
    } catch (e: any) {
      toast(e?.message || "失败");
    } finally {
      setProgress(100);
      setTimeout(() => setBusy(false), 300);
    }
  }

  async function doGenerate(_key: string) {
    const t0 = performance.now();
    const res = await fetch("https://oaiapi.asia/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash-image",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: ensureImageReturn(prompt) },
              ...imgs.map((im) => ({ type: "image_url", image_url: { url: im.url } })),
            ],
          },
        ],
      }),
    });

    const txt = await res.text();
    const directUrls = extractImageUrlsFromText(txt);
    if (directUrls.length > 0) {
      const dur = (performance.now() - t0) / 1000;
      for (const url of directUrls) {
        addRun(url, dur / directUrls.length);
      }
      return;
    }

    const json = safeJson(txt);
    if (!res.ok) {
      const msg = (json?.error?.message || `HTTP ${res.status}`).slice(0, 200);
      throw new Error(msg);
    }

    const msg = json?.choices?.[0]?.message;
    let urls: string[] = [];

    if (Array.isArray(msg?.content)) {
      for (const b of msg.content) {
        if (b?.type === "image_url" && b.image_url?.url)
          urls.push(safeUrl(b.image_url.url));
        if (b?.type === "text" && typeof b.text === "string") {
          urls.push(...extractImageUrlsFromText(b.text).map(safeUrl));
          urls.push(...extractDataUris(b.text));
        }
      }
    } else if (typeof msg?.content === 'string') {
      urls.push(...extractImageUrlsFromText(msg.content).map(safeUrl));
    }

    if (!urls.length && json?.choices && typeof json.choices === 'string') {
      urls.push(...extractImageUrlsFromText(json.choices).map(safeUrl));
    }

    if (!urls.length && Array.isArray(json?.choices)) {
      for (const choice of json.choices) {
        if (typeof choice === 'string') {
          urls.push(...extractImageUrlsFromText(choice).map(safeUrl));
        }
      }
    }

    if (!urls.length) {
      urls.push(...extractImageUrlsFromText(JSON.stringify(json)).map(safeUrl));
    }

    if (!urls.length && Array.isArray(json?.images)) {
      urls = json.images
        .map((im: any) => im?.image_url?.url || "")
        .filter(Boolean)
        .map(safeUrl);
    }

    const finalUrls = Array.from(new Set(urls)).filter(Boolean);
    if (finalUrls.length === 0) {
      throw new Error("未返回图片");
    }

    const dur = (performance.now() - t0) / 1000;
    for (const url of finalUrls) {
      addRun(url, dur / finalUrls.length);
    }
  }

  function addRun(url: string, durSec = 0) {
    const ts = new Date().toLocaleString();
    const id = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const newRun = { id, ts, durSec, url };

    setRuns((s) => {
      const updatedRuns = [newRun, ...s];
      localStorage.setItem("runs", JSON.stringify(updatedRuns));
      return updatedRuns;
    });
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">[AI-Tool-2025-10-15]</h1>
      <p className="text-sm text-gray-600 mt-1">[core: gemini-2.5-flash-image] [status: online]</p>

      <section className="mt-6 space-y-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">提示词</label>
          <textarea
            className="w-full min-h-28 rounded-md border p-3"
            placeholder="请输入提示词"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">生成数量</label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`rounded-md border px-4 py-2 ${
                  batchSize === n
                    ? "bg-black text-white"
                    : "bg-white text-black"
                }`}
                onClick={() => setBatchSize(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">
            上传图片（0~8）
          </label>
          <div
            className="rounded-md border-2 border-dashed p-6 text-center text-gray-600"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
          >
            拖拽到此或点击选择
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => onFiles(e.target.files)}
            />
          </div>
          {!!imgs.length && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {imgs.map((x, i) => (
                <div
                  key={i}
                  className="relative rounded-md border overflow-hidden"
                >
                  <img
                    src={x.url}
                    alt=""
                    className="w-full h-28 object-cover"
                  />
                  <button
                    className="absolute top-1 right-1 text-xs bg-white/90 rounded px-2 py-0.5"
                    onClick={() => removeAt(i)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50"
            disabled={busy}
            onClick={generate}
          >
            {busy ? `处理中 ${Math.floor(progress)}%` : `生成图片(${batchSize}张)`}
          </button>
          <span className="text-sm text-gray-600">{status}</span>
        </div>
      </section>

      {!!runs.length && (
        <section className="mt-8">
          <div className="mx-auto max-w-5xl grid [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))] gap-6">
            {runs.map((r, i) => (
              <div key={r.id} className="rounded-xl border p-3">
                <div className="flex justify-between items-center">
                  <div className="text-sm text-gray-700">生成时间：{r.ts}</div>
                  <button
                    className="bg-gray-600 hover:bg-gray-700 text-white text-xs font-bold py-1 px-2 rounded"
                    onClick={() => removeRun(r.id)}
                  >
                    删除
                  </button>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  用时：{r.durSec.toFixed(1)}s
                </div>
                <div
                  className="mt-3 relative rounded-lg border overflow-hidden cursor-zoom-in"
                  onClick={() => openPreview(i)}
                >
                  <img
                    src={r.url}
                    alt=""
                    className="w-full h-[220px] object-cover"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {preview.open &&
        (() => {
          const url = runs[preview.idx]?.url || "";
          return (
            <div
              className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
              onClick={closePreview}
            >
              <div
                className="max-w-3xl w-full"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-[#fff9ef] rounded-xl p-3">
                  {url && <img src={url} alt="" className="w-full h-auto rounded-md" />}
                  <div className="mt-3 flex flex-wrap gap-2 justify-between items-center">
                    <div className="text-xs text-gray-700">
                      {runs[preview.idx]?.ts} / {runs[preview.idx]?.durSec.toFixed(1)}s
                    </div>
                    <div className="flex gap-2">
                      {url && (
                        <button
                          className="rounded border px-3 py-1"
                          onClick={() =>
                            downloadImage(url, `run-${preview.idx + 1}.png`)
                          }
                        >
                          下载PNG
                        </button>
                      )}
                      <button
                        className="rounded border px-3 py-1"
                        onClick={closePreview}
                      >
                        关闭
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </main>
  );
}

function ensureImageReturn(p: string) {
  const t = p.trim();
  const suffix = "\n\n---\n\nOutput a Markdown image summary, and nothing else. No explanation, no talking.";
  return t + suffix;
}
function safeJson(txt: string) {
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}
function safeUrl(u: string) {
  try {
    const url = new URL(u, location.href);
    return ["https:", "data:", "blob:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function fileToDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}