"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { BODY_MAX } from "@/lib/comments/body";
import type { CommentView } from "@/lib/comments/types";

/**
 * Writing a comment or a reply.
 *
 * The failure messages are TRANSLATED from the server's reason code rather
 * than shown raw: "duplicate" is a machine word, and "you have already posted
 * that" is the sentence that tells somebody what to do instead. A 429 in
 * particular must not read as an error — the limiter is the product working.
 */
export function CommentForm({
  subjectId,
  replyTo,
  onPosted,
  onCancel,
}: {
  subjectId: string;
  /** Set when this is a reply, for the placeholder and the parent id. */
  replyTo?: CommentView | null;
  onPosted: (created: {
    id: string;
    body: string;
    parentId: string | null;
  }) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("comments");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || body.trim().length === 0) return;

    setBusy(true);
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectType: "lesson",
          subjectId,
          parentId: replyTo?.id ?? null,
          body,
        }),
      });

      if (!response.ok) {
        const reason = (
          (await response.json().catch(() => ({}))) as {
            error?: string;
          }
        ).error;

        // Mapped to sentences a person can act on. Anything unrecognised
        // falls back to the general failure rather than showing a code.
        const message =
          reason === "duplicate"
            ? t("duplicate")
            : reason === "too-fast" || reason === "hourly-limit"
              ? t("tooFast")
              : reason === "too-short" || reason === "empty-after-trim"
                ? t("tooShort")
                : reason === "too-long"
                  ? t("tooLong")
                  : t("postFailed");

        toast.error({ title: message, description: "" });
        return;
      }

      const created = (await response.json()) as {
        id: string;
        parentId: string | null;
      };
      // The body is passed back from here rather than re-fetched: the reader
      // expects to see what they just wrote, immediately.
      onPosted({ ...created, body: body.trim() });
      setBody("");
    } catch {
      toast.error({ title: t("postFailed"), description: "" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={
          replyTo
            ? t("replyPlaceholder", {
                name: replyTo.authorName ?? t("someone"),
              })
            : t("placeholder")
        }
        maxLength={BODY_MAX}
        rows={replyTo ? 2 : 3}
        aria-label={replyTo ? t("reply") : t("placeholder")}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || body.trim() === ""}>
          {busy ? t("posting") : t("post")}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
