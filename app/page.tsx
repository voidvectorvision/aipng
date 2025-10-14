"use client";

import { useMemo, useRef, useState } from "react";
import { z } from "zod";

const MAX_FILES = 8;
const fileOk = (f: File) =>
  f.type.startsWith("image/") && f.size <= 10 * 1024 * 1024;

const schema = z.object({
  prompt: z.string().min(1, "请输入提示词").max(1000),
  key: z.string().optional(), // 仅当你用“可公开 publishable key”时可置空
});

type Img = { name: string; url: string };

export default function Page() {
  const [prompt, setPrompt] = useState("");
  const [key, setKey] = useState<string>();
  // () => sessionStorage.getItem("nb:key") || ""
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("就绪");
  const [imgs, setImgs] = useState<Img[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ open: boolean; idx: number }>({
    open: false,
    idx: 0,
  });
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
    // data:/blob: 直接下载
    if (url.startsWith("data:") || url.startsWith("blob:")) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.replace(/\.+$/, "");
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    // 其它走同源中转，避免 CORS
    const a = document.createElement("a");
    a.href = `/api/download?url=${encodeURIComponent(
      url
    )}&filename=${encodeURIComponent(filename.replace(/\.+$/, ""))}`;
    a.download = filename.replace(/\.+$/, "");
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downscaleDataURL(
    dataURL: string,
    maxSide = 2048,
    quality = 0.82
  ): Promise<string> {
    const img = new Image();
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
    // Markdown: ![alt](url)
    const md = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = md.exec(t))) out.push(m[1]);
    // 裸链接
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
      const down = await downscaleDataURL(b64, 2048, 0.82); // 新增：压到最长边≤2048
      added.push({ name: f.name, url: down });
    }
    setImgs((s) => [...s, ...added]);
  }

  function removeAt(i: number) {
    setImgs((s) => s.filter((_, idx) => idx !== i));
  }

  function saveKey() {
    sessionStorage.setItem("nb:key", key.trim());
    toast("Key 已保存到本会话");
  }
  function clearKey() {
    sessionStorage.removeItem("nb:key");
    setKey("");
    toast("已清除 Key");
  }

  async function generate() {
    const t0 = performance.now();
    const check = schema.safeParse({ prompt, key: key?.trim() });
    if (!check.success) return toast(check.error.issues[0].message);

    const _key = key?.trim() || process.env.NEXT_PUBLIC_PUBLISHABLE_KEY || "";
    if (!_key) return toast("缺少 Key");

    setBusy(true);
    setStatus("请求中…");

    try {
      const endpoint = "https://oaiapi.asia/v1/chat/completions";

      // 按标准 messages[].content[] 组织
      const content: any[] = [
        { type: "text", text: ensureImageReturn(prompt) },
      ];
      for (const im of imgs)
        content.push({ type: "image_url", image_url: { url: im.url } });

      const body = {
        model: "gemini-2.5-flash-image",
        messages: [{ role: "user", content }],
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const txt = await res.text();
      const json = safeJson(txt);
      if (!res.ok) {
        const msg = (json?.error?.message || `HTTP ${res.status}`).slice(
          0,
          200
        );
        throw new Error(msg);
      }

      // 解析优先级：message.content[].image_url → data:image → 纯文本URL
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
          if (typeof b === "string") {
            urls.push(...extractImageUrlsFromText(b).map(safeUrl));
            urls.push(...extractDataUris(b));
          }
        }
      }

      if (!urls.length && Array.isArray(json?.images)) {
        urls = json.images
          .map((im: any) => im?.image_url?.url || "")
          .filter(Boolean)
          .map(safeUrl);
      }

      if (!urls.length) {
        const raw = String(msg?.content || "");
        urls = extractDataUris(raw);
        if (!urls.length) urls = extractImageUrlsFromText(raw).map(safeUrl);
      }

      urls = Array.from(new Set(urls)).filter(Boolean);
      if (!urls.length) {
        // ⬇️ 自动重试一次，强约束输出
        const retryContent = [
          {
            type: "text",
            text:
              ensureImageReturn(prompt) +
              " 只返回图片，不要文字；如无法生成，请返回原因。",
          },
          ...imgs.map((im) => ({
            type: "image_url",
            image_url: { url: im.url },
          })),
        ];
        const retryBody = {
          model: "gemini-2.5-flash-image",
          messages: [{ role: "user", content: retryContent }],
        };
        const r2 = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(retryBody),
        });
        const t2 = await r2.text();
        const j2 = safeJson(t2);
        const m2 = j2?.choices?.[0]?.message;

        // 再试解析
        if (Array.isArray(m2?.content)) {
          for (const b of m2.content) {
            if (b?.type === "image_url" && b.image_url?.url)
              urls.push(safeUrl(b.image_url.url));
            if (b?.type === "text") {
              urls.push(...extractDataUris(b.text));
              urls.push(...extractImageUrlsFromText(b.text).map(safeUrl));
            }
          }
        } else {
          const raw = String(m2?.content || "");
          urls.push(...extractDataUris(raw));
          urls.push(...extractImageUrlsFromText(raw).map(safeUrl));
        }
        urls = Array.from(new Set(urls)).filter(Boolean);

        if (!urls.length) {
          // 仍无图，给出原因提示
          const reason =
            typeof m2?.content === "string" && m2.content
              ? m2.content.slice(0, 200)
              : "未返回图片";
          toast(reason);
          setBusy(false);
          return;
        }
      }

      const dur = (performance.now() - t0) / 1000;
      openNewRun(urls, dur);
      toast(`完成：${urls.length} 张`);
    } catch (e: any) {
      toast(e?.message || "失败");
    } finally {
      setBusy(false);
    }
  }

  // 简单结果区
  type Run = { id: string; ts: string; durSec: number; url: string };
  const [runs, setRuns] = useState<Run[]>([]);

  function openNewRun(urls: string[], durSec = 0) {
    const ts = new Date().toLocaleString();
    const url = urls[0];
    if (!url) return;
    const id = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    setRuns((s) => [{ id, ts, durSec, url }, ...s]); // 仍然置顶，但 key 稳定
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">AI PNG · 最小版</h1>
      <p className="text-sm text-gray-600 mt-1">
        静态导出可用；Key 仅会话保存。
      </p>

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
          <label className="block text-sm text-gray-600 mb-1">
            上传图片（0~8）
          </label>
          <div
            className="rounded-md border-2 border-dashed p-6 text-center text-gray-600"
            onDragOver={(e) => {
              e.preventDefault();
            }}
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

        <div>
          <label className="block text-sm text-gray-600 mb-1">
            Key（会话内保存）
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              inputMode="text"
              className="flex-1 rounded-md border p-3"
              placeholder="粘贴你的 key（或使用 NEXT_PUBLIC_PUBLISHABLE_KEY）"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="rounded-md border px-3" onClick={saveKey}>
              保存
            </button>
            <button className="rounded-md border px-3" onClick={clearKey}>
              清除
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50"
            disabled={busy}
            onClick={generate}
          >
            {busy ? "处理中…" : "生成图片"}
          </button>
          <span className="text-sm text-gray-600">{status}</span>
        </div>
      </section>

      {!!runs.length && (
        <section className="mt-8">
          <div className="mx-auto max-w-5xl grid [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))] gap-6">
            {runs.map((r) => (
              <div key={r.id} className="rounded-xl border p-3">
                {/* ... */}
                <div
                  className="mt-3 relative rounded-lg border overflow-hidden cursor-zoom-in"
                  onClick={() => openPreview(r.id)} // 若你用 id 控预览
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
                className="max-w-5xl w-full"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-[#fff9ef] rounded-xl p-3">
                  <img src={url} alt="" className="w-full h-auto rounded-md" />
                  <div className="mt-3 flex flex-wrap gap-2 justify-between items-center">
                    <div className="text-xs text-gray-700">
                      第 {preview.idx + 1} / {runs.length}
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="rounded border px-3 py-1"
                        onClick={() =>
                          downloadImage(url, `run-${preview.idx + 1}.png`)
                        }
                      >
                        下载PNG
                      </button>
                      <button
                        className="rounded border px-3 py-1"
                        onClick={prevImg}
                      >
                        上一张
                      </button>
                      <button
                        className="rounded border px-3 py-1"
                        onClick={nextImg}
                      >
                        下一张
                      </button>
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
  return /务必返回图片$/.test(t)
    ? t
    : t + (/[。.!?？]$/.test(t) ? "" : "。") + "务必返回图片";
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
