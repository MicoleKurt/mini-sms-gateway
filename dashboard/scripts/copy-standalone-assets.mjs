// Runs after "next build".
//
// With output: "standalone", Next.js writes a self-contained server to
// .next/standalone but leaves the browser assets out, because they are often
// served by a CDN. Here the same server serves them, so they are copied next
// to it. After this step .next/standalone is everything needed to run the
// dashboard: "npm run start" and the Docker image both run exactly that.
import { cpSync } from "node:fs";

cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
