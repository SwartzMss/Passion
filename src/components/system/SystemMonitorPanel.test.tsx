import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SystemMonitorPanel } from "./SystemMonitorPanel";

vi.mock("../../lib/api", () => ({
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
  render(<SystemMonitorPanel />);

  expect(screen.getByRole("heading", { name: "系统监控" })).toBeInTheDocument();
  expect(screen.getByText("查看本机基础资源占用。")).toBeInTheDocument();

  expect((await screen.findAllByText("27.4%")).length).toBeGreaterThan(0);
  expect(screen.getByText("8.0 GB / 16.0 GB")).toBeInTheDocument();
  expect(screen.getByText("120.0 GB / 256.0 GB")).toBeInTheDocument();
  expect(screen.getByText("1 小时 1 分钟")).toBeInTheDocument();
  expect(screen.getByText(/上次更新：/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "CPU 使用率" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "内存" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "磁盘" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "运行时长" })).toBeInTheDocument();
  expect(screen.queryByLabelText("自动刷新")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /资源使用趋势/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "磁盘分区使用情况" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /高占用进程/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "系统信息" })).not.toBeInTheDocument();
});

it("refreshes the system snapshot on demand", async () => {
  const user = userEvent.setup();
  render(<SystemMonitorPanel />);

  await screen.findAllByText("27.4%");
  await user.click(screen.getByRole("button", { name: /刷新/ }));

  const api = await import("../../lib/api");
  expect(api.getSystemSnapshot).toHaveBeenCalledTimes(2);
});
