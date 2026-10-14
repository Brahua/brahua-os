// POST /api/finance/email-ingest: where the owner's Apps Script delivers bank emails (SPEC-finance-email).
// `handleEmailIngest` authenticates the Bearer secret before reading the body and answers a bare 404
// to anyone else. The script is the only caller; see docs/finance-email-setup.md (E4).
import { getDb } from "@/lib/db";
import { handleEmailIngest } from "@/modules/finance/email/ingest";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Any other method gets the same bare 404 as a wrong secret: nothing says the endpoint exists.
const notFound = (): Response => new Response(null, { status: 404 });
export const GET = notFound;
export const HEAD = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;

export async function POST(request: Request): Promise<Response> {
  return handleEmailIngest(request, { db: getDb() });
}
