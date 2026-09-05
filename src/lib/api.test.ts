import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { onPortScanProgress } from "./events";
import { startPortScan, stopPortScan } from "./api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it("starts and stops a port scan through Tauri", async () => {
  const mockedInvoke = vi.mocked(invoke);
  mockedInvoke
    .mockResolvedValueOnce("scan-1")
    .mockResolvedValueOnce(undefined);

  await startPortScan({ host: "127.0.0.1", startPort: 1, endPort: 3 });
  await stopPortScan("scan-1");

  expect(mockedInvoke).toHaveBeenNthCalledWith(1, "start_port_scan", {
    input: { host: "127.0.0.1", startPort: 1, endPort: 3 },
  });
  expect(mockedInvoke).toHaveBeenNthCalledWith(2, "stop_port_scan", {
    scanId: "scan-1",
  });
});

it("forwards port scan progress events and returns the unlisten function", async () => {
  const handler = vi.fn();
  const unlisten = vi.fn();
  vi.mocked(listen).mockResolvedValue(unlisten);

  const result = onPortScanProgress(handler);
  expect(listen).toHaveBeenCalledWith("port-scan-progress", expect.any(Function));

  const callback = vi.mocked(listen).mock.calls[0][1] as (event: {
    payload: { scanId: string; completed: number; total: number; done: boolean; stopped: boolean };
  }) => void;
  const payload = {
    scanId: "scan-1",
    completed: 2,
    total: 3,
    done: false,
    stopped: false,
  };
  callback({ payload });

  expect(handler).toHaveBeenCalledWith(payload);
  await expect(result).resolves.toBe(unlisten);
});
