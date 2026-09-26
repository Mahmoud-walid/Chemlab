import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";
import type { PermissionGroup } from "@/db/queries/admin/roles";

interface SetGrantsInput {
  roleId: string;
  permissionNames: string[];
}

// Typed rather than `vi.fn()`, so `mock.calls[0]![0]` is a payload and not
// `undefined` — the assertions below read the argument, and an untyped mock
// makes that a cast that `tsc` rejects while vitest happily runs it.
const setRolePermissions = vi.fn<
  (input: SetGrantsInput) => Promise<{ ok: boolean }>
>(async () => ({ ok: true }));

vi.mock("@/app/[locale]/(admin)/admin/roles/actions", () => ({
  setRolePermissions: (input: SetGrantsInput) => setRolePermissions(input),
}));
vi.mock("@/components/ui/sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { GrantsEditor } =
  await import("@/app/[locale]/(admin)/admin/roles/features/grants-editor");

/**
 * The bug this file exists for.
 *
 * A permission the role grants but the READER does not hold is "locked": it has
 * to survive the save, because dropping it from the payload would be a silent
 * revocation of exactly the grants the reader is not trusted to touch. The first
 * version seeded the checkbox state from the role's whole grant list, so those
 * locked names appeared in the list as well — ticked, and apparently
 * toggleable. Unticking one did nothing, because `save` re-adds them
 * unconditionally.
 *
 * A control that moves and changes nothing is worse than an absent one: the
 * operator believes the grant was removed. Found by re-reading the diff, not by
 * a failing test, which is why it gets one.
 */

const GROUPS: PermissionGroup[] = [
  {
    resource: "lesson",
    permissions: [
      {
        name: "lesson:read",
        resource: "lesson",
        action: "read",
        description: null,
      },
      {
        name: "lesson:create",
        resource: "lesson",
        action: "create",
        description: null,
      },
    ],
  },
  {
    resource: "audit",
    permissions: [
      {
        name: "audit:read",
        resource: "audit",
        action: "read",
        description: null,
      },
    ],
  },
];

const LABELS = {
  save: "Save grants",
  saving: "Saving…",
  saved: "Grants saved",
  failed: "Nothing was changed",
  clearAll: "Clear selection",
  noPermissions: "No grants",
};

function renderEditor(props: {
  granted: string[];
  grantable: string[];
  locked: string[];
  editable?: boolean;
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <GrantsEditor
        roleId="role-1"
        groups={GROUPS}
        editable={props.editable ?? true}
        labels={LABELS}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  setRolePermissions.mockClear();
});

describe("a permission the reader cannot grant", () => {
  it("is not offered as a checkbox", () => {
    renderEditor({
      granted: ["lesson:read", "audit:read"],
      grantable: ["lesson:read", "lesson:create"],
      locked: ["audit:read"],
    });

    expect(screen.getByRole("checkbox", { name: /read/ })).toBeInTheDocument();
    // `audit:read` has no box. It is shown above as a fixed chip instead, so
    // the role's real grants are still visible.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("audit:read")).toBeVisible();
  });

  it("is still sent on save, so the save is not a silent revocation", async () => {
    renderEditor({
      granted: ["lesson:read", "audit:read"],
      grantable: ["lesson:read", "lesson:create"],
      locked: ["audit:read"],
    });

    await userEvent.click(screen.getByRole("button", { name: LABELS.save }));

    expect(setRolePermissions).toHaveBeenCalledTimes(1);
    const payload = setRolePermissions.mock.calls[0]![0];
    expect([...payload.permissionNames].sort()).toEqual([
      "audit:read",
      "lesson:read",
    ]);
  });

  it("survives Clear selection, which only clears what the reader owns", async () => {
    // The button says "clear selection", and the locked grants are not part of
    // the selection — clearing them would be the revocation this guards.
    renderEditor({
      granted: ["lesson:read", "audit:read"],
      grantable: ["lesson:read", "lesson:create"],
      locked: ["audit:read"],
    });

    await userEvent.click(
      screen.getByRole("button", { name: LABELS.clearAll }),
    );
    await userEvent.click(screen.getByRole("button", { name: LABELS.save }));

    const payload = setRolePermissions.mock.calls[0]![0];
    expect(payload.permissionNames).toEqual(["audit:read"]);
  });
});

describe("the ordinary case", () => {
  it("starts with the role's grants ticked", () => {
    renderEditor({
      granted: ["lesson:create"],
      grantable: ["lesson:read", "lesson:create"],
      locked: [],
    });

    expect(screen.getByRole("checkbox", { name: /create/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /read/ })).not.toBeChecked();
  });

  it("sends exactly what is ticked", async () => {
    renderEditor({
      granted: ["lesson:create"],
      grantable: ["lesson:read", "lesson:create"],
      locked: [],
    });

    await userEvent.click(screen.getByRole("checkbox", { name: /read/ }));
    await userEvent.click(screen.getByRole("button", { name: LABELS.save }));

    const payload = setRolePermissions.mock.calls[0]![0];
    expect([...payload.permissionNames].sort()).toEqual([
      "lesson:create",
      "lesson:read",
    ]);
  });

  it("offers no form at all when it is not editable", () => {
    // A system role: the seed reconciles its grants on every deploy, so an edit
    // would appear to work and revert. Absent, not disabled.
    renderEditor({
      granted: ["lesson:read"],
      grantable: ["lesson:read"],
      locked: [],
      editable: false,
    });

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: LABELS.save })).toBeNull();
    // But the grants are still readable.
    expect(screen.getByText("lesson:read")).toBeVisible();
  });
});
