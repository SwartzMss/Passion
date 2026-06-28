import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { NetworkDiagnosticsPanel } from "./NetworkDiagnosticsPanel";

vi.mock("../../lib/api", () => ({
  checkPort: vi.fn(async ({ host, port }: { host: string; port: number }) => ({
    host,
    port,
    open: port === 2,
    elapsedMs: 12,
    error: port === 2 ? null : "connection refused",
  })),
  inspectPortOccupancy: vi.fn(async ({ port }: { port: number }) => ({
    port,
    entries:
      port === 1420
        ? [
            {
              protocol: "TCP",
              localAddress: "127.0.0.1:1420",
              state: "LISTENING",
              pid: 1234,
              processName: "node.exe",
            },
          ]
        : [],
  })),
}));

it("renders the network diagnostics workspace", () => {
  render(<NetworkDiagnosticsPanel />);

  expect(screen.getByRole("heading", { name: "网络检测" })).toBeInTheDocument();
  expect(screen.getByText("检查 TCP 端口开放情况和本机端口占用。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "使用说明" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "端口检测" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: "单端口" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "范围扫描" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByLabelText("端口号", { selector: "#network-port" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "端口占用" })).not.toBeInTheDocument();
  expect(screen.getByText(/端口检测支持域名、IPv4 地址，端口范围 1-65535。/)).toBeInTheDocument();
});

it("shows one network diagnostic tab at a time", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.click(screen.getByRole("tab", { name: "端口占用" }));

  expect(screen.getByRole("tab", { name: "端口占用" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByLabelText("端口号", { selector: "#occupancy-port" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "范围扫描" })).not.toBeInTheDocument();
});

it("checks a tcp port and shows result", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.clear(screen.getByLabelText("端口号", { selector: "#network-port" }));
  await user.type(screen.getByLabelText("端口号", { selector: "#network-port" }), "80");
  await user.click(screen.getByRole("button", { name: /检测端口/ }));

  expect(await screen.findByText("未开放")).toBeInTheDocument();
  const api = await import("../../lib/api");
  expect(api.checkPort).toHaveBeenCalledWith({ host: "127.0.0.1", port: 80 });
});

it("scans a range and shows open ports", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.click(screen.getByRole("button", { name: "范围扫描" }));
  await user.clear(screen.getByLabelText("起始端口"));
  await user.type(screen.getByLabelText("起始端口"), "1");
  await user.clear(screen.getByLabelText("结束端口"));
  await user.type(screen.getByLabelText("结束端口"), "3");
  await user.click(screen.getByRole("button", { name: /开始扫描/ }));

  expect(await screen.findByText("已发现 1 个开放端口")).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "2" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "TCP" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "开放" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "12ms" })).toBeInTheDocument();
  const api = await import("../../lib/api");
  expect(api.checkPort).toHaveBeenCalledWith({ host: "127.0.0.1", port: 1 });
  expect(api.checkPort).toHaveBeenCalledWith({ host: "127.0.0.1", port: 2 });
  expect(api.checkPort).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3 });
});

it("warns but allows large port ranges", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.click(screen.getByRole("button", { name: "范围扫描" }));
  await user.clear(screen.getByLabelText("起始端口"));
  await user.type(screen.getByLabelText("起始端口"), "1");
  await user.clear(screen.getByLabelText("结束端口"));
  await user.type(screen.getByLabelText("结束端口"), "1002");

  expect(screen.getByText(/端口范围较大，扫描可能较慢/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /开始扫描/ })).toBeEnabled();
});

it("shows an empty state when a range scan finds no open ports", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.click(screen.getByRole("button", { name: "范围扫描" }));
  await user.clear(screen.getByLabelText("起始端口"));
  await user.type(screen.getByLabelText("起始端口"), "3");
  await user.clear(screen.getByLabelText("结束端口"));
  await user.type(screen.getByLabelText("结束端口"), "4");
  await user.click(screen.getByRole("button", { name: /开始扫描/ }));

  expect(await screen.findByText("已发现 0 个开放端口")).toBeInTheDocument();
  expect(screen.getByText("暂未发现开放端口")).toBeInTheDocument();
  expect(screen.getByText("扫描完成后，开放端口会显示在这里。")).toBeInTheDocument();
});

it("inspects port occupancy and shows process details", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.click(screen.getByRole("tab", { name: "端口占用" }));
  await user.clear(screen.getByLabelText("端口号", { selector: "#occupancy-port" }));
  await user.type(screen.getByLabelText("端口号", { selector: "#occupancy-port" }), "1420");
  await user.click(screen.getByRole("button", { name: /查看占用/ }));

  expect(await screen.findByText("端口 1420 已被占用")).toBeInTheDocument();
  expect(screen.getByText("node.exe")).toBeInTheDocument();
  expect(screen.getByText("PID 1234")).toBeInTheDocument();
  expect(screen.getByText("127.0.0.1:1420")).toBeInTheDocument();
  const api = await import("../../lib/api");
  expect(api.inspectPortOccupancy).toHaveBeenCalledWith({ port: 1420 });
});

it("shows a clear available state when a port is not occupied", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.click(screen.getByRole("tab", { name: "端口占用" }));
  await user.clear(screen.getByLabelText("端口号", { selector: "#occupancy-port" }));
  await user.type(screen.getByLabelText("端口号", { selector: "#occupancy-port" }), "8081");
  await user.click(screen.getByRole("button", { name: /查看占用/ }));

  expect(await screen.findByText("端口 8081 未被占用")).toBeInTheDocument();
  expect(screen.getByText("未发现监听进程，可以用于新服务或端口转发。")).toBeInTheDocument();
});

it("validates port values before running checks", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);

  await user.clear(screen.getByLabelText("端口号", { selector: "#network-port" }));
  await user.type(screen.getByLabelText("端口号", { selector: "#network-port" }), "70000");

  expect(screen.getByText("端口范围 1-65535")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /检测端口/ })).toBeDisabled();
});
