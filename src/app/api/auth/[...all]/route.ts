// Better Auth HTTP handler (/api/auth/*). The auth instance is created on the first request,
// so `next build` needs no secrets.
import { getAuth } from "@/lib/auth";

function handle(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
