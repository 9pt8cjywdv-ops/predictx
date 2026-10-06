"use server";

import type { RegulatoryStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { addProvision, addRegulatoryDocument, transitionRegulatoryDocument } from "@/lib/regulatory/library";
import { transitionRegulatoryVersion } from "@/lib/regulatory/service";

const STATUSES: RegulatoryStatus[] = ["DRAFT", "UNDER_REVIEW", "APPROVED", "PUBLISHED", "SUPERSEDED", "WITHDRAWN"];

function fail(path: string, e: unknown): never {
  const known = e instanceof Error && "status" in e;
  if (!known) console.error(e);
  redirect(`${path}?error=${encodeURIComponent(known ? (e as Error).message : "Unexpected error.")}`);
}

function status(form: FormData): RegulatoryStatus {
  const s = String(form.get("to")) as RegulatoryStatus;
  if (!STATUSES.includes(s)) throw Object.assign(new Error("Invalid status."), { status: 400 });
  return s;
}

export async function addRegulatoryDocumentAction(form: FormData) {
  const user = await requireUser();
  let id: string;
  try {
    const file = form.get("file");
    const fields = Object.fromEntries([...form.entries()].filter(([k]) => k !== "file"));
    const doc = await addRegulatoryDocument(
      user,
      fields,
      file instanceof File && file.size > 0 ? { name: file.name, data: Buffer.from(await file.arrayBuffer()) } : undefined,
    );
    id = doc.id;
  } catch (e) {
    fail("/regulatory", e);
  }
  redirect(`/regulatory/documents/${id}`);
}

export async function addProvisionAction(documentId: string, form: FormData) {
  const user = await requireUser();
  const path = `/regulatory/documents/${documentId}`;
  try {
    await addProvision(user, documentId, Object.fromEntries(form));
  } catch (e) {
    fail(path, e);
  }
  revalidatePath(path);
  redirect(path);
}

export async function transitionDocumentAction(documentId: string, form: FormData) {
  const user = await requireUser();
  const path = `/regulatory/documents/${documentId}`;
  try {
    await transitionRegulatoryDocument(user, documentId, status(form), String(form.get("reason") ?? ""));
  } catch (e) {
    fail(path, e);
  }
  revalidatePath(path);
  redirect(path);
}

export async function transitionVersionAction(versionId: string, form: FormData) {
  const user = await requireUser();
  const path = `/regulatory/versions/${versionId}`;
  try {
    await transitionRegulatoryVersion(user, versionId, status(form), String(form.get("notes") ?? "") || undefined);
  } catch (e) {
    fail(path, e);
  }
  revalidatePath(path);
  redirect(path);
}
