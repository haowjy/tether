/** Called inside the user's gesture. */
export async function writeClipboardText(text: string): Promise<"ok" | "denied"> {
  try {
    await navigator.clipboard.writeText(text);
    return "ok";
  } catch {
    return "denied";
  }
}
