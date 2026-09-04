import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useCommonState from "@/hooks/use-common-state";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

describe("useCommonState", () => {
  it("starts from sensible defaults", () => {
    const { result } = renderHook(() => useCommonState());

    expect(result.current.confirmType).toBeNull();
    expect(result.current.error).toBe("");
    expect(result.current.loading).toBe(false);
    expect(result.current.showPreview).toBe(false);
    expect(result.current.isConfirmed).toBe(false);
    expect(result.current.refreshFn).toBeNull();
    expect(result.current.modalMode).toBe("add");
    expect(result.current.modalOpen).toBe(false);
  });

  it("exposes the router", () => {
    const { result } = renderHook(() => useCommonState());
    expect(result.current.router.push).toBe(push);
  });

  it("updates each piece of state independently", () => {
    const { result } = renderHook(() => useCommonState());

    act(() => {
      result.current.setError("Something went wrong");
      result.current.setLoading(true);
      result.current.setShowPreview(true);
      result.current.setIsConfirmed(true);
      result.current.setConfirmType("reset");
      result.current.setModalMode("edit");
      result.current.setModalOpen(true);
    });

    expect(result.current.error).toBe("Something went wrong");
    expect(result.current.loading).toBe(true);
    expect(result.current.showPreview).toBe(true);
    expect(result.current.isConfirmed).toBe(true);
    expect(result.current.confirmType).toBe("reset");
    expect(result.current.modalMode).toBe("edit");
    expect(result.current.modalOpen).toBe(true);
  });

  it("stores a refresh callback without invoking it", () => {
    const refresh = vi.fn();
    const { result } = renderHook(() => useCommonState());

    act(() => result.current.setRefreshFn(() => refresh));
    expect(result.current.refreshFn).toBe(refresh);
    expect(refresh).not.toHaveBeenCalled();

    act(() => result.current.refreshFn?.());
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
