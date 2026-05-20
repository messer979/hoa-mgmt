import Link from "next/link";
import { Nav } from "@/components/nav";

export default function NotFound() {
  return (
    <div>
      <Nav />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-3">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted">
          The page you’re looking for doesn’t exist or has been moved.
        </p>
        <Link href="/topics" className="btn-primary inline-block">
          Back to Topics
        </Link>
      </main>
    </div>
  );
}
