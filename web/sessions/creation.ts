// What the two creation dialogs send (client-architecture.md §6.3 "Creation"). Both fields
// are optional: a blank name lets tmux choose, a blank directory uses tmux's default. The
// daemon checks that the directory exists, so this only catches what can't be a path at all.
import type { ClientMsg, SessionRef } from "../proto/generated/messages";

export interface CreationFields {
  name?: string;
  dir?: string;
}

export type CreationParse = { ok: CreationFields } | { error: string };

export function parseCreation(name: string, dir: string): CreationParse {
  const trimmedDir = dir.trim();
  if (trimmedDir !== "" && !trimmedDir.startsWith("/")) return { error: "Enter an absolute path, such as /home/you/project" };
  const trimmedName = name.trim();
  return { ok: { ...(trimmedName !== "" && { name: trimmedName }), ...(trimmedDir !== "" && { dir: trimmedDir }) } };
}

export function newSessionMsg(req: number, fields: CreationFields): ClientMsg {
  return { type: "newSession", data: { req, ...fields } };
}

export function newWindowMsg(req: number, session: SessionRef, fields: CreationFields): ClientMsg {
  return { type: "newWindow", data: { req, session, ...fields } };
}
