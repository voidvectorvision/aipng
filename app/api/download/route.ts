// app/api/download/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  const name = (searchParams.get("filename") || "image").replace(/[\/\\:*?"<>|]+/g, "");

  if (!url) return new NextResponse("missing url", { status: 400 });

  // 方式1：重定向让浏览器自己下
  // 带上下载文件名提示
  const headers = new Headers();
  headers.set(
    "Content-Disposition",
    `attachment; filename="${name}.png"`
  );
  headers.set("Cache-Control", "no-store");

  return NextResponse.redirect(url, { headers });
}