"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import * as mutations from "@/lib/bom-mutations";

type Result = { error?: string };

// BOM writes live in src/lib/bom-mutations.ts (shared with the REST API);
// these actions add the session check and the redirects.

export async function createBom(input: { name: string; description: string }): Promise<Result> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  const result = await mutations.createBom(session.user.id, input);
  if (!result.id) return result;
  redirect(`/boms/${result.id}`);
}

export async function updateBom(input: {
  id: string;
  name: string;
  description: string;
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  return mutations.updateBom(input);
}

export async function deleteBom(input: { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const result = await mutations.deleteBom(input.id);
  if (result.error) return result;
  redirect("/boms");
}

export async function addBomItem(input: Parameters<typeof mutations.addBomItem>[0]): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  return mutations.addBomItem(input);
}

export async function updateBomItem(input: Parameters<typeof mutations.updateBomItem>[0]): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  return mutations.updateBomItem(input);
}

export async function removeBomItem(input: { id: string }): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  return mutations.removeBomItem(input);
}

export async function buildBom(input: {
  bomId: string;
  units: string | number;
  note?: string;
}): Promise<Result & { taken?: number }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  const result = await mutations.buildBom(session.user.id, input);
  return result.error ? { error: result.error } : { taken: result.draws?.length ?? 0 };
}

export async function importBomCsv(input: {
  bomId: string;
  csv: string;
  createMissing: boolean;
}): Promise<Result & { summary?: mutations.ImportSummary }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  return mutations.importBomCsv(session.user.id, input);
}
