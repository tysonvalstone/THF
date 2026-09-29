import { helpIndex } from "@/lib/help/content";

/** Article list with plain text, for client-side search */
export async function GET() {
  return Response.json(await helpIndex());
}
