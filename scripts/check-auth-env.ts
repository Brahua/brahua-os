// Fails the production build when an auth variable is missing or invalid (see
// scripts/vercel-build.sh), instead of deploying an app that cannot sign anyone in.
// Prints variable names only, never their values.
import { resolveAuthEnv } from "@/lib/auth-env";

try {
  const env = resolveAuthEnv(process.env);
  console.log(`Auth configuration OK (base URL ${env.baseURL}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
