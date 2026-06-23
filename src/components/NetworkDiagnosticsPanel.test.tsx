import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { NetworkDiagnosticsPanel } from "./NetworkDiagnosticsPanel";

vi.mock("../lib/api", () => ({
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

it("renders the network diagnostics workspace", () => {
  render(<NetworkDiagnosticsPanel />);

  expect(screen.getByRole("heading", { name: "网络检测" })).toBeInTheDocument();
  expect(screen.getByText("检查 TCP 端口开放情况和本机端口占用。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "使用说明" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "端口检测" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("heading", { name: "端口检测" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "端口占用" })).not.toBeInTheDocument();
  expect(screen.getByText(/端口检测支持域名、IPv4 地址，端口范围 1-65535。/)).toBeInTheDocument();
});

it("shows one network diagnostic tab at a time", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.click(screen.getByRole("tab", { name: "端口占用" }));

  expect(screen.getByRole("tab", { name: "端口占用" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("heading", { name: "端口占用" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "端口检测" })).not.toBeInTheDocument();
});

it("checks a tcp port and shows result", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.clear(screen.getByLabelText("端口号", { selector: "#network-port" }));
  await user.type(screen.getByLabelText("端口号", { selector: "#network-port" }), "80");
  await user.click(screen.getByRole("button", { name: /检测端口/ }));

  expect(await screen.findByText("未开放")).toBeInTheDocument();
  const api = await import("../lib/api");
  expect(api.checkPort).toHaveBeenCalledWith({ host: "127.0.0.1", port: 80 });
});

it("inspects port occupancy and shows process details", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.click(screen.getByRole("tab", { name: "端口占用" }));
  await user.clear(screen.getByLabelText("端口号", { selector: "#occupancy-port" }));
  await user.type(screen.getByLabelText("端口号", { selector: "#occupancy-port" }), "1420");
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

  await user.clear(screen.getByLabelText("端口号", { selector: "#network-port" }));
  await user.type(screen.getByLabelText("端口号", { selector: "#network-port" }), "70000");

  expect(screen.getByText("端口范围 1-65535")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /检测端口/ })).toBeDisabled();
});
