import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-muted-foreground">That page doesn&apos;t exist, or the profile is hidden.</p>
      <Link href="/leaderboard" className="text-primary hover:underline">Back to the leaderboard</Link>
    </div>
  );
}
