import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SshTunnelsPanel } from "./SshTunnelsPanel";

const stoppedTunnel = {
  id: "ssh-1",
  name: "QNX调试",
  description: "debug",
  localPort: 8080,
  bindAddress: "127.0.0.1",
  remoteHost: "172.31.3.1",
  remotePort: 22,
  username: "root",
  keyPath: "C:\\keys\\8797_rsa2048",
  authType: "private_key",
  status: "stopped",
  pid: null,
  startedAt: null,
  errorMessage: null,
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const runningTunnel = {
  ...stoppedTunnel,
  id: "ssh-2",
  name: "Web访问",
  localPort: 8081,
  remotePort: 80,
  status: "running",
  pid: 1234,
  startedAt: "2026-06-26T01:00:00Z",
};

const errorTunnel = {
  ...stoppedTunnel,
  id: "ssh-3",
  name: "失败隧道",
  localPort: 8082,
  status: "error",
  errorMessage: "Permission denied (publickey).",
};

vi.mock("../../lib/api", () => ({
  getSshTunnelSettings: vi.fn(async () => ({
    sshExecutablePath: "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
  })),
  updateSshTunnelSettings: vi.fn(async (input) => input),
  listSshTunnels: vi.fn(async () => [
    stoppedTunnel,
    runningTunnel,
    errorTunnel,
  ]),
  createSshTunnel: vi.fn(async () => runningTunnel),
  updateSshTunnel: vi.fn(async () => stoppedTunnel),
  deleteSshTunnel: vi.fn(async () => undefined),
  startSshTunnel: vi.fn(async () => runningTunnel),
  stopSshTunnel: vi.fn(async () => stoppedTunnel),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => "C:\\keys\\selected_key"),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it("loads and shows SSH tunnels", async () => {
  render(<SshTunnelsPanel />);

  expect(screen.getByRole("heading", { name: "SSH 隧道" })).toBeInTheDocument();
  expect(
    await screen.findByDisplayValue("C:\\Windows\\System32\\OpenSSH\\ssh.exe"),
  ).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "全部 3" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "运行中 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已停止 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "异常 1" })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "SSH 隧道列表" })).toBeInTheDocument();
  expect(screen.getByText("QNX调试")).toBeInTheDocument();
  expect(screen.getByText("127.0.0.1:8080")).toBeInTheDocument();
  expect(screen.getAllByText("172.31.3.1:22").length).toBeGreaterThan(0);
});

it("starts, stops, restarts, and deletes tunnels", async () => {
  const user = userEvent.setup();
  render(<SshTunnelsPanel />);

  const stoppedRow = await screen.findByRole("row", { name: /QNX调试/ });
  await user.click(within(stoppedRow).getByRole("button", { name: "启动" }));

  const runningRow = screen.getByRole("row", { name: /Web访问/ });
  await user.click(within(runningRow).getByRole("button", { name: "停止" }));
  expect(within(runningRow).queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();

  const errorRow = screen.getByRole("row", { name: /失败隧道/ });
  await user.click(within(errorRow).getByRole("button", { name: "重启" }));
  await user.click(within(errorRow).getByRole("button", { name: "删除" }));

  const api = await import("../../lib/api");
  expect(api.startSshTunnel).toHaveBeenCalledWith("ssh-1");
  expect(api.stopSshTunnel).toHaveBeenCalledWith("ssh-2");
  expect(api.startSshTunnel).toHaveBeenCalledWith("ssh-3");
  expect(api.deleteSshTunnel).toHaveBeenCalledWith("ssh-3");
});

it("validates create form and submits create-and-start", async () => {
  const user = userEvent.setup();
  render(<SshTunnelsPanel />);

  await user.click(await screen.findByRole("button", { name: "新建隧道" }));
  await user.click(screen.getByRole("button", { name: "创建并启动" }));
  expect(screen.getByText("隧道名称不能为空。")).toBeInTheDocument();

  await user.type(screen.getByLabelText("隧道名称"), "QNX调试2");
  await user.clear(screen.getByLabelText("本地端口"));
  await user.type(screen.getByLabelText("本地端口"), "8088");
  await user.type(screen.getByLabelText("远程地址"), "172.31.3.1");
  await user.clear(screen.getByLabelText("远程端口"));
  await user.type(screen.getByLabelText("远程端口"), "22");
  await user.type(screen.getByLabelText("用户名"), "root");
  await user.click(screen.getByRole("button", { name: "选择私钥" }));
  await user.click(screen.getByRole("button", { name: "创建并启动" }));

  const api = await import("../../lib/api");
  expect(api.createSshTunnel).toHaveBeenCalledWith({
    name: "QNX调试2",
    description: null,
    localPort: 8088,
    bindAddress: "127.0.0.1",
    remoteHost: "172.31.3.1",
    remotePort: 22,
    username: "root",
    keyPath: "C:\\keys\\selected_key",
  });
});

it("updates SSH executable path setting", async () => {
  const user = userEvent.setup();
  render(<SshTunnelsPanel />);

  const input = await screen.findByLabelText("SSH 程序路径");
  await user.clear(input);
  await user.type(input, "D:\\Git\\usr\\bin\\ssh.exe");
  await user.click(screen.getByRole("button", { name: "保存 SSH 路径" }));

  const api = await import("../../lib/api");
  expect(api.updateSshTunnelSettings).toHaveBeenCalledWith({
    sshExecutablePath: "D:\\Git\\usr\\bin\\ssh.exe",
  });
});

it("shows error details", async () => {
  render(<SshTunnelsPanel />);

  expect(await screen.findByText("Permission denied (publickey).")).toBeInTheDocument();
});
