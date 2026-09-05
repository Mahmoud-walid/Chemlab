import { Skeleton } from "@/components/ui/skeleton";

/**
 * The shell is server-rendered and only the content streams, so this is a
 * shape rather than a spinner: a spinner throws away the one thing the shell
 * already knows, which is roughly what is about to appear.
 */
export default function AdminLoading() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
