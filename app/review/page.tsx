"use client";

import { useEffect, useState } from "react";
import { z } from "zod";

const schema = z.object({
  article: z.string().min(1, "请输入Google Play App介绍").max(20000),
  referenceArticle: z.string().min(1, "请输入参考App测评").max(20000),
  key: z.string().optional(),
});

type Run = { id: string; ts: string; durSec: number; text: string };

export default function Page() {
  const [article, setArticle] = useState("");
  const [referenceArticle, setReferenceArticle] = useState("");
  const [key, ] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("就绪");
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    const savedRuns = localStorage.getItem("runs-rewrite");
    if (savedRuns) {
      setRuns(JSON.parse(savedRuns));
    }
  }, []);

  function toast(s: string) {
    setStatus(s);
    setTimeout(() => setStatus("就绪"), 1600);
  }

  function removeRun(id: string) {
    setRuns((s) => {
      const newRuns = s.filter((r) => r.id !== id);
      localStorage.setItem("runs-rewrite", JSON.stringify(newRuns));
      return newRuns;
    });
  }

  function saveReferenceTemplate() {
    if (!referenceArticle.trim()) {
      toast("请先输入参考App测评内容");
      return;
    }
    localStorage.setItem("reference-template", referenceArticle);
    toast("模板已保存");
  }

  function loadReferenceTemplate() {
    const template = localStorage.getItem("reference-template");
    if (template) {
      setReferenceArticle(template);
      toast("模板已加载");
    } else {
      toast("未找到保存的模板");
    }
  }

  async function generate() {
    const check = schema.safeParse({ article, referenceArticle, key: key?.trim() });
    if (!check.success) return toast(check.error.issues[0].message);
    const _key = key?.trim() || process.env.NEXT_PUBLIC_PUBLISHABLE_KEY || "";
    if (!_key) return toast("缺少 Key");

    setBusy(true);
    setStatus(`正在生成...`);

    try {
      await doGenerate(_key);
      toast(`完成`);
    } catch (e: unknown) {
      toast((e as Error)?.message || "失败");
    } finally {
      setBusy(false);
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
        model: "gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: ensureRewriteArticle(article, referenceArticle),
          },
        ],
        temperature: 0.7,
        top_p: 0.9,
      }),
    });

    const txt = await res.text();
    const json = safeJson(txt);
    if (!res.ok) {
      const msg = (json?.error?.message || `HTTP ${res.status}`).slice(0, 200);
      throw new Error(msg);
    }

    const rewrittenText = json?.choices?.[0]?.message?.content;
    if (!rewrittenText) {
      throw new Error("未返回结果");
    }

    // 筛选结果，只保留HTML内容
    const filteredText = extractHtmlContent(rewrittenText);

    const dur = (performance.now() - t0) / 1000;
    addRun(filteredText, dur);
  }

  function addRun(text: string, durSec = 0) {
    const ts = new Date().toLocaleString();
    const id = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const newRun = { id, ts, durSec, text };

    setRuns((s) => {
      const updatedRuns = [newRun, ...s];
      localStorage.setItem("runs-rewrite", JSON.stringify(updatedRuns));
      return updatedRuns;
    });
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="text-xl sm:text-2xl font-bold">App测评生成器</h1>
      <p className="text-sm text-muted-foreground mt-1">[core: gemini-2.5-flash] [status: online]</p>

      <section className="mt-6 space-y-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Google Play App介绍</label>
          <textarea
            className="w-full min-h-36 rounded-md border p-3 bg-transparent"
            placeholder="请输入Google Play的app介绍内容"
            value={article}
            onChange={(e) => setArticle(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm text-muted-foreground mb-1">参考App测评（含HTML格式）</label>
          <textarea
            className="w-full min-h-36 rounded-md border p-3 bg-transparent"
            placeholder="请输入已有的app测评文章（包含HTML格式标签）"
            value={referenceArticle}
            onChange={(e) => setReferenceArticle(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button
              className="text-xs rounded border px-3 py-1 hover:bg-muted"
              onClick={saveReferenceTemplate}
            >
              保存模板
            </button>
            <button
              className="text-xs rounded border px-3 py-1 hover:bg-muted"
              onClick={loadReferenceTemplate}
            >
              加载模板
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="rounded-md bg-foreground text-background px-4 py-2 disabled:opacity-50"
            disabled={busy}
            onClick={generate}
          >
            {busy ? `处理中...` : `生成App测评`}
          </button>
          <span className="text-sm text-muted-foreground">{status}</span>
        </div>
      </section>

      {!!runs.length && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">生成历史</h2>
          <div className="mt-4 space-y-6">
            {runs.map((r) => (
              <div key={r.id} className="rounded-xl border p-4">
                <div className="flex justify-between items-center">
                  <div className="text-sm text-muted-foreground">生成时间：{r.ts}</div>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => removeRun(r.id)}
                  >
                    删除
                  </button>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  用时：{r.durSec.toFixed(1)}s
                </div>
                <div className="mt-3 whitespace-pre-wrap">{r.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function ensureRewriteArticle(article: string, referenceArticle: string) {
  return `You are an expert app review writer. Your task is to create a new app review by combining information from an existing app review and a Google Play app description.

**CRITICAL REQUIREMENTS:**
1. Return ONLY valid, well-formed HTML content starting with <p> tags
2. Ensure ALL HTML tags are properly opened and closed (e.g., <p>...</p>, <li>...</li>)
3. Do NOT include any explanations, thinking process, timestamps, or additional text
4. Follow the EXACT HTML structure and formatting from the reference review
5. Verify all <ul>, <li>, <p>, <h2>, <h3> tags are correctly formatted

**Instructions:**
1. Analyze the writing style, tone, and HTML formatting structure from the existing app review
2. Extract key features and information from the Google Play app description
3. Create a new, comprehensive app review that:
   - Maintains the same HTML formatting and structure as the reference review
   - Incorporates relevant features and details from the Google Play description
   - Uses a similar writing style and tone
   - Provides valuable insights for potential users
   - Keeps the same level of detail and organization

**Reference App Review (for style and HTML format):**
${referenceArticle}

**Google Play App Description (for content and features):**
${article}

Return only valid HTML content with proper tag structure:`;
}

function extractHtmlContent(text: string): string {
  // 移除生成时间、删除、用时等元数据
  let cleaned = text.replace(/生成时间：[^\n]*\n/g, '');
  cleaned = cleaned.replace(/删除\s*\n/g, '');
  cleaned = cleaned.replace(/用时：[^\n]*\n/g, '');
  
  // 移除 *Thinking...* 整个部分（更精确的匹配）
  cleaned = cleaned.replace(/\*Thinking\.\.\.\*[\s\S]*?(?=<[a-zA-Z])/g, '');
  
  // 移除所有 > ** 开头的思考过程行
  cleaned = cleaned.replace(/>\s*\*\*[\s\S]*?(?=<[a-zA-Z])/g, '');
  
  // 移除反引号和其他非HTML文本，但保持HTML标签完整
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`[^`]*`/g, '');
  
  // 查找第一个HTML标签的位置（不仅仅是<p>）
  const htmlTagMatch = cleaned.match(/<[a-zA-Z][^>]*>/);
  if (htmlTagMatch) {
    const htmlStartIndex = cleaned.indexOf(htmlTagMatch[0]);
    cleaned = cleaned.substring(htmlStartIndex);
  }
  
  // 移除HTML内容前的任何非HTML文本
  cleaned = cleaned.replace(/^[^<]*(?=<)/, '');
  
  // 移除开头和结尾的空白字符
  cleaned = cleaned.trim();
  
  // 基本的HTML标签修复
  cleaned = cleaned.replace(/<<p/g, '<li><p');
  cleaned = cleaned.replace(/<<li/g, '<li');
  
  return cleaned;
}

function safeJson(txt: string) {
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}