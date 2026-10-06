"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient, createEngagement } from "@/lib/clients";

function errorRedirect(path: string, e: unknown): never {
  const message = e instanceof Error && "status" in e ? e.message : "Unexpected error.";
  if (!(e instanceof Error && "status" in e)) console.error(e);
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createClientAction(form: FormData) {
  const user = await requireUser();
  let id: string;
  try {
    const client = await createClient(user, Object.fromEntries(form));
    id = client.id;
  } catch (e) {
    errorRedirect("/clients", e);
  }
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

export async function createEngagementAction(clientId: string, form: FormData) {
  const user = await requireUser();
  let id: string;
  try {
    const engagement = await createEngagement(user, clientId, Object.fromEntries(form));
    id = engagement.id;
  } catch (e) {
    errorRedirect(`/clients/${clientId}`, e);
  }
  redirect(`/engagements/${id}`);
}
