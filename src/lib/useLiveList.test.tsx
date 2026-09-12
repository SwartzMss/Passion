import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLiveList } from "./useLiveList";

afterEach(() => { vi.useRealTimers(); });

it("polls without overlapping slow reads and stops on unmount", async () => {
  vi.useFakeTimers();
  let finish!: (items: number[]) => void;
  const load = vi.fn(() => new Promise<number[]>((resolve) => { finish = resolve; }));
  const { result, unmount } = renderHook(() => useLiveList(load));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => finish([1]));
  expect(result.current.items).toEqual([1]);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(load).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => finish([2]));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(load).toHaveBeenCalledTimes(2);
});

it("ignores an older read when a mutation triggers a newer refresh", async () => {
  let finishOld!: (items: number[]) => void;
  const load = vi.fn<() => Promise<number[]>>()
    .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValue([2]);
  const { result } = renderHook(() => useLiveList(load));
  await act(async () => result.current.refresh());
  await act(async () => finishOld([1]));
  expect(result.current.items).toEqual([2]);
});

it("recovers from a failed refresh on the next poll", async () => {
  vi.useFakeTimers();
  const load = vi.fn<() => Promise<number[]>>()
    .mockRejectedValueOnce({ message: "暂时不可用" }).mockResolvedValue([3]);
  const { result } = renderHook(() => useLiveList(load));
  await act(async () => {});
  expect(result.current.error).toBe("暂时不可用");
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(result.current.items).toEqual([3]);
  expect(result.current.error).toBeNull();
});
