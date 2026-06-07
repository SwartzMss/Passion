import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { NetworkDiagnosticsPanel } from "./NetworkDiagnosticsPanel";

vi.mock("../lib/api", () => ({
  pingHost: vi.fn(async () => ({
    host: "127.0.0.1",
    reachable: true,
    summary: "可达",
    rawOutput: "reply",
  })),
  checkPort: vi.fn(async () => ({
    host: "127.0.0.1",
    port: 80,
    open: false,
    elapsedMs: 12,
    error: "connection refused",
  })),
}));

it("rejects empty ping host", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel onBack={() => {}} />);

  await user.click(screen.getByRole("button", { name: "Ping" }));

  expect(screen.getByText("请输入要 Ping 的 IP 或域名。")).toBeInTheDocument();
});

it("runs ping and shows result", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel onBack={() => {}} />);

  await user.type(screen.getByLabelText("Ping 目标"), "127.0.0.1");
  await user.click(screen.getByRole("button", { name: "Ping" }));

  expect(await screen.findByText("可达")).toBeInTheDocument();
  const api = await import("../lib/api");
  expect(api.pingHost).toHaveBeenCalledWith({ host: "127.0.0.1" });
});

it("checks a tcp port and shows result", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel onBack={() => {}} />);

  await user.clear(screen.getByLabelText("Port"));
  await user.type(screen.getByLabelText("Port"), "80");
  await user.click(screen.getByRole("button", { name: "检测端口" }));

  expect(await screen.findByText("端口关闭")).toBeInTheDocument();
  const api = await import("../lib/api");
  expect(api.checkPort).toHaveBeenCalledWith({ host: "127.0.0.1", port: 80 });
});
