import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { NetworkDiagnosticsPanel } from "./NetworkDiagnosticsPanel";

vi.mock("../lib/api", () => ({
  pingHost: vi.fn(async () => ({
    host: "127.0.0.1",
    reachable: true,
    summary: "可达 time=8ms",
    rawOutput: "reply time=8ms",
  })),
  checkPort: vi.fn(async () => ({
    host: "127.0.0.1",
    port: 80,
    open: false,
    elapsedMs: 12,
    error: "connection refused",
  })),
  inspectPortOccupancy: vi.fn(async () => ({
    port: 1420,
    entries: [
      {
        protocol: "TCP",
        localAddress: "127.0.0.1:1420",
        state: "LISTENING",
        pid: 1234,
        processName: "node.exe",
      },
    ],
  })),
}));

it("rejects empty ping host", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.click(screen.getByRole("button", { name: /开始 Ping/ }));

  expect(screen.getByText("请输入要 Ping 的 IP 或域名。")).toBeInTheDocument();
});

it("runs ping and shows result", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.type(screen.getByLabelText("Ping 目标"), "127.0.0.1");
  await user.click(screen.getByRole("button", { name: /开始 Ping/ }));

  expect(await screen.findByText("Ping 成功")).toBeInTheDocument();
  expect(screen.getByText("响应时间 8ms")).toBeInTheDocument();
  expect(screen.getByText("历史记录（1）")).toBeInTheDocument();
  const api = await import("../lib/api");
  expect(api.pingHost).toHaveBeenCalledWith({ host: "127.0.0.1" });
});

it("checks a tcp port and shows result", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.clear(screen.getByLabelText("Port"));
  await user.type(screen.getByLabelText("Port"), "80");
  await user.click(screen.getByRole("button", { name: /检测端口/ }));

  expect(await screen.findByText("未开放")).toBeInTheDocument();
  const api = await import("../lib/api");
  expect(api.checkPort).toHaveBeenCalledWith({ host: "127.0.0.1", port: 80 });
});

it("inspects port occupancy and shows process details", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.clear(screen.getByLabelText("占用端口"));
  await user.type(screen.getByLabelText("占用端口"), "1420");
  await user.click(screen.getByRole("button", { name: /查看占用/ }));

  expect(await screen.findByText("已占用")).toBeInTheDocument();
  expect(screen.getByText("node.exe")).toBeInTheDocument();
  expect(screen.getByText("PID 1234")).toBeInTheDocument();
  expect(screen.getByText("127.0.0.1:1420")).toBeInTheDocument();
  const api = await import("../lib/api");
  expect(api.inspectPortOccupancy).toHaveBeenCalledWith({ port: 1420 });
});

it("validates port values before running checks", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.clear(screen.getByLabelText("Port"));
  await user.type(screen.getByLabelText("Port"), "70000");

  expect(screen.getByText("端口范围 1-65535")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /检测端口/ })).toBeDisabled();
});
