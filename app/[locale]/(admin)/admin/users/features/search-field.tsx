"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Search, written to the URL.
 *
 * The URL is the state, deliberately — a filtered list is then linkable,
 * survives a reload and can be sent to somebody else. Component state would
 * lose all three the moment the page re-renders on the server.
 *
 * Submitted rather than typed-through: a request per keystroke against a
 * table of people is a lot of queries to answer a question nobody has
 * finished asking.
 */
export function SearchField({
  label,
  placeholder,
}: {
  label: string;
  placeholder: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState("");

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const query = value.trim();
    startTransition(() => {
      // Page 1, always: staying on page 4 of the previous result set shows an
      // empty table and reads as "no matches".
      router.push(
        query ? `${pathname}?q=${encodeURIComponent(query)}` : pathname,
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-1.5">
      <Label htmlFor="user-search">{label}</Label>
      <Input
        id="user-search"
        type="search"
        value={value}
        disabled={pending}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}
