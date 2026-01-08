import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

// Upload a JSON file to Vercel Blob.
// Protects with a simple secret so random users can't upload.
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.BLOB_UPLOAD_SECRET || ""}`;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "Missing BLOB_READ_WRITE_TOKEN in environment." },
      { status: 500 }
    );
  }

  if (!process.env.BLOB_UPLOAD_SECRET) {
    return NextResponse.json(
      { ok: false, error: "Missing BLOB_UPLOAD_SECRET in environment." },
      { status: 500 }
    );
  }

  if (auth !== expected) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  const filename = body?.filename;
  const jsonText = body?.jsonText;

  if (!filename || typeof filename !== "string") {
    return NextResponse.json({ ok: false, error: "Missing filename." }, { status: 400 });
  }

  if (!jsonText || typeof jsonText !== "string") {
    return NextResponse.json({ ok: false, error: "Missing jsonText (string)." }, { status: 400 });
  }

  // Store under a predictable prefix
  const key = `accidents/${filename}`;

  const { url } = await put(key, jsonText, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });

  return NextResponse.json({ ok: true, key, url });
}
