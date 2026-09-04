"use client";

import { useState } from "react";

import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { initialsOf } from "@/lib/initials";

export interface AccountMenuLabels {
  openMenu: string;
  avatarAlt: string;
  profile: string;
  myExams: string;
  savedItems: string;
  settings: string;
  signOut: string;
  signedOut: string;
}

export function AccountMenuClient({
  displayName,
  email,
  avatarUrl,
  labels,
}: {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  labels: AccountMenuLabels;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await authClient.signOut();
      toast.success({ title: labels.signedOut, description: "" });
      router.push("/");
      // The server components above hold the previous session in their render
      // output; without this the header keeps showing the avatar until the
      // next full navigation.
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={labels.openMenu}
        >
          <Avatar className="size-8">
            {avatarUrl && (
              <AvatarImage src={avatarUrl} alt={labels.avatarAlt} />
            )}
            <AvatarFallback>{initialsOf(displayName)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">
            {displayName}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/profile">{labels.profile}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/profile/exams">{labels.myExams}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/profile/saved">{labels.savedItems}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/profile/settings">{labels.settings}</Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={pending} onSelect={handleSignOut}>
          {labels.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
