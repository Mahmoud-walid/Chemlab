import { after } from "next/server";
import type { NextRequest } from "next/server";

import {
  exportAttempts,
  exportEvents,
  exportFunnel,
  recentExportTimes,
} from "@/db/queries/admin/export";
import { recordActivity } from "@/lib/activity/record";
import {
  ForbiddenError,
  UnauthenticatedError,
  hasPermission,
  requirePermission,
} from "@/lib/authz";
import {
  contentDisposition,
  csvRow,
  exportFilename,
  UTF8_BOM,
} from "@/lib/exports/csv";
import {
  DATASETS,
  EXPORT_WINDOW_MS,
  decideExportRate,
  isExportDataset,
  type ExportDataset,
} from "@/lib/exports/policy";

/**
 * `GET /api/admin/export?dataset=…`
 *
 * A route handler rather than a server action, because the answer is a FILE.
 * A server action returns a value to a React tree — to download from one you
 * would have to build the whole document in memory, ship it through the RSC
 * payload, and reassemble it in the browser as a Blob. That is three copies of
 * an export that may be a hundred thousand rows, two of them in a phone's
 * memory. A GET streams straight to disk and gives the browser a real
 * download, resumable and cancellable, with no JavaScript involved.
 *
 * It is a GET despite writing an activity row, and the write is the reason to
 * think about it: a GET should be safe. The row is an audit record of a read,
 * not a state change a caller can direct, so a repeated request is a repeated
 * — and correctly logged — read. That is the same bargain every access log
 * makes.
 */

export const dynamic = "force-dynamic";
/** Node, not edge: this streams from Postgres for as long as it takes. */
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const datasetParam = url.searchParams.get("dataset") ?? "";

  if (!isExportDataset(datasetParam)) {
    return problem(400, "unknown dataset");
  }
  const dataset: ExportDataset = datasetParam;
  const spec = DATASETS[dataset];

  // FIRST statement of real work, before any parameter is trusted for
  // anything: the permission decides whether this request exists at all.
  let actor;
  try {
    actor = await requirePermission(spec.permission);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return problem(401, "sign in");
    if (error instanceof ForbiddenError) {
      // 404, matching every admin page: a 403 on `?dataset=events` confirms
      // the dataset exists and that this account is merely short of one
      // grant, which is a map for anyone probing.
      return problem(404, "not found");
    }
    throw error;
  }

  const canSeePii = spec.piiPermission
    ? hasPermission(actor, spec.piiPermission)
    : true;

  // Rate limit AFTER authorization, so an unauthorized caller cannot spend
  // somebody else's allowance or learn anything from the difference.
  const rate = decideExportRate(
    await recentExportTimes(
      actor.userId,
      new Date(Date.now() - EXPORT_WINDOW_MS),
    ),
    new Date(),
  );
  if (!rate.allowed) {
    return new Response("too many exports\n", {
      status: 429,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "retry-after": String(rate.retryAfterSeconds),
      },
    });
  }

  const shape =
    dataset === "events"
      ? exportEvents(eventFilters(url), canSeePii, spec.maxRows)
      : dataset === "attempts"
        ? exportAttempts(
            { quizSlug: url.searchParams.get("quiz") ?? undefined },
            spec.maxRows,
          )
        : exportFunnel(...funnelRange(url));

  // Recorded here, not after the stream finishes: the callback of `after()`
  // runs once the RESPONSE is done, and a download the client cancels halfway
  // still read every row it received. An export that is only logged when it
  // completes is an audit trail with an opt-out.
  after(async () => {
    await recordActivity({
      verb: "admin.exported",
      objectType: "export",
      objectId: dataset,
      metadata: {
        dataset,
        includedPii: canSeePii,
        filters: Object.fromEntries(url.searchParams.entries()),
      },
      actorId: actor.userId,
    });
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(UTF8_BOM + csvRow(shape.header)));
      try {
        for await (const batch of shape.rows) {
          for (const row of batch) {
            controller.enqueue(encoder.encode(csvRow(row)));
          }
        }
      } catch (error) {
        // The header and some rows are already on the wire, so there is no
        // status code left to change: a truncated CSV would look like a
        // complete one that happens to end early. A final comment line says
        // otherwise, and the server-side log carries the actual error.
        console.error("Export failed mid-stream", error);
        controller.enqueue(
          encoder.encode(csvRow(["# export failed before the end"])),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": contentDisposition(
        exportFilename(dataset, new Date()),
      ),
      // A file with someone's name and email in it must not sit in a shared
      // cache, a CDN, or a back-button restore.
      "cache-control": "no-store, private",
      // Belt and braces against a browser sniffing the CSV as HTML.
      "x-content-type-options": "nosniff",
    },
  });
}

function eventFilters(url: URL) {
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  return {
    verb: url.searchParams.get("verb") ?? undefined,
    group: url.searchParams.get("status") ?? undefined,
    from: parseDate(url.searchParams.get("from")),
    to: parseDate(url.searchParams.get("to")),
    query: query || undefined,
  };
}

/** The dashboard's window, defaulting to the 30 days the charts show. */
function funnelRange(url: URL): [Date, Date] {
  const to = parseDate(url.searchParams.get("to")) ?? new Date();
  const from =
    parseDate(url.searchParams.get("from")) ??
    new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return [from, to];
}

/** An unparseable date is dropped rather than becoming an Invalid Date that
 * Postgres would reject halfway through the response. */
function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function problem(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
