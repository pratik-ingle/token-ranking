import { identicon } from "@tokenrank/shared";
import { cn } from "@/lib/utils";

/** Avatar generated from a hash of the username — no photos, nothing uploaded. */
export function Identicon({ username, size = 32, className }: { username: string; size?: number; className?: string }) {
  const { cells, foreground, background } = identicon(username);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 6 6"
      className={cn("shrink-0 rounded-md", className)}
      role="img"
      aria-label={`${username}'s avatar`}
    >
      <rect width="6" height="6" fill={background} />
      {cells.flatMap((row, y) =>
        row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x + 0.5} y={y + 0.5} width="1.02" height="1.02" fill={foreground} /> : null)),
      )}
    </svg>
  );
}
