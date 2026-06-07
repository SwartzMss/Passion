import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SystemMonitorPanel } from "./SystemMonitorPanel";

vi.mock("../lib/api", () => ({
  getSystemSnapshot: vi.fn(async () => ({
    cpuUsagePercent: 27.4,
    memoryUsedBytes: 8 * 1024 * 1024 * 1024,
    memoryTotalBytes: 16 * 1024 * 1024 * 1024,
    diskUsedBytes: 120 * 1024 * 1024 * 1024,
    diskTotalBytes: 256 * 1024 * 1024 * 1024,
    uptimeSeconds: 3661,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it("loads and shows a system snapshot", async () => {
  render(<SystemMonitorPanel onBack={() => {}} />);

  expect(await screen.findByText("27.4%")).toBeInTheDocument();
  expect(screen.getByText("8.0 GB / 16.0 GB")).toBeInTheDocument();
  expect(screen.getByText("120.0 GB / 256.0 GB")).toBeInTheDocument();
  expect(screen.getByText("1 小时 1 分钟")).toBeInTheDocument();
});

it("refreshes the system snapshot on demand", async () => {
  const user = userEvent.setup();
  render(<SystemMonitorPanel onBack={() => {}} />);

  await screen.findByText("27.4%");
  await user.click(screen.getByRole("button", { name: "刷新" }));

  const api = await import("../lib/api");
  expect(api.getSystemSnapshot).toHaveBeenCalledTimes(2);
});
