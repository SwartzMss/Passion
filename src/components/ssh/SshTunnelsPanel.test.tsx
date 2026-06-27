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
  expect(screen.getByText("通过 SSH 端口转发访问远程设备和服务。")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /全部\s*3/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /运行中\s*1/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /已停止\s*2/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /异常/ })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "隧道列表" })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "SSH 隧道列表" })).toBeInTheDocument();
  expect(document.querySelector(".ssh-col-name")).toBeInTheDocument();
  expect(document.querySelector(".ssh-col-actions")).toBeInTheDocument();
  expect(screen.getByText(/共 3 条/)).toBeInTheDocument();
  expect(screen.getByText(/运行中: 1/)).toBeInTheDocument();
  expect(screen.getByText(/已停止: 2/)).toBeInTheDocument();
  expect(screen.queryByText(/异常: 1/)).not.toBeInTheDocument();
  expect(screen.getByText("⌕")).toBeInTheDocument();
  expect(screen.queryByLabelText("SSH 程序路径")).not.toBeInTheDocument();
  expect(screen.getByText("QNX调试")).toBeInTheDocument();
  expect(screen.getByText("8080")).toBeInTheDocument();
  expect(screen.getAllByText("172.31.3.1:22").length).toBeGreaterThan(0);
});

it("shows a detailed empty state when no tunnel matches", async () => {
  const user = userEvent.setup();
  render(<SshTunnelsPanel />);

  await user.type(await screen.findByLabelText("搜索 SSH 隧道"), "not found");

  expect(screen.getByText("暂无 SSH 隧道")).toBeInTheDocument();
  expect(
    screen.getByText("点击右上角“新建隧道”创建一个本地端口转发。"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: "SSH 隧道列表" })).not.toBeInTheDocument();
});

it("starts, stops, restarts, and deletes tunnels", async () => {
  const user = userEvent.setup();
  render(<SshTunnelsPanel />);

  const stoppedRow = await screen.findByRole("row", { name: /QNX调试/ });
  expect(stoppedRow.querySelectorAll(".ssh-action-slot")).toHaveLength(3);
  await user.click(within(stoppedRow).getByRole("button", { name: "启动" }));

  const runningRow = screen.getByRole("row", { name: /Web访问/ });
  expect(runningRow.querySelectorAll(".ssh-action-slot")).toHaveLength(3);
  expect(within(runningRow).getByRole("button", { name: "编辑" })).toBeDisabled();
  expect(within(runningRow).getByRole("button", { name: "删除" })).toBeDisabled();
  await user.click(within(runningRow).getByRole("button", { name: "停止" }));

  const errorRow = screen.getByRole("row", { name: /失败隧道/ });
  expect(within(errorRow).getByText("已停止")).toBeInTheDocument();
  expect(within(errorRow).queryByText("异常")).not.toBeInTheDocument();
  await user.click(within(errorRow).getByRole("button", { name: "启动" }));
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
  const dialog = screen.getByRole("dialog", { name: "新建隧道" });
  expect(screen.getByRole("table", { name: "SSH 隧道列表" })).toBeInTheDocument();
  expect(within(dialog).queryByLabelText("描述")).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("group", { name: "绑定地址" })).not.toBeInTheDocument();
  expect(within(dialog).getAllByText("*")).toHaveLength(6);
  expect(within(dialog).getByPlaceholderText("请输入隧道名称")).toBeInTheDocument();
  expect(within(dialog).getByPlaceholderText("如：192.168.1.10")).toBeInTheDocument();
  expect(within(dialog).getByPlaceholderText("如：root")).toBeInTheDocument();
  expect(within(dialog).getByPlaceholderText("选择私钥文件（如：id_rsa）")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "保存并启动" })).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "保存并启动" }));
  expect(within(dialog).getByText("隧道名称不能为空。")).toBeInTheDocument();

  await user.type(within(dialog).getByLabelText("隧道名称"), "QNX调试2");
  await user.clear(within(dialog).getByLabelText("本地端口"));
  await user.type(within(dialog).getByLabelText("本地端口"), "8088");
  await user.type(within(dialog).getByLabelText("远程地址"), "172.31.3.1");
  await user.clear(within(dialog).getByLabelText("远程端口"));
  await user.type(within(dialog).getByLabelText("远程端口"), "22");
  await user.type(within(dialog).getByLabelText("用户名"), "root");
  await user.click(within(dialog).getByRole("button", { name: "选择文件" }));
  await user.click(within(dialog).getByRole("button", { name: "保存并启动" }));

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
  expect(screen.queryByRole("dialog", { name: "新建隧道" })).not.toBeInTheDocument();
});

it("opens edit form in a dialog", async () => {
  const user = userEvent.setup();
  render(<SshTunnelsPanel />);

  const stoppedRow = await screen.findByRole("row", { name: /QNX调试/ });
  await user.click(within(stoppedRow).getByRole("button", { name: "编辑" }));

  const dialog = screen.getByRole("dialog", { name: "编辑隧道" });
  expect(within(dialog).getByLabelText("隧道名称")).toHaveValue("QNX调试");
  expect(screen.getByRole("table", { name: "SSH 隧道列表" })).toBeInTheDocument();
});

it("hides tunnel error details in the list", async () => {
  render(<SshTunnelsPanel />);

  await screen.findByText("失败隧道");

  expect(screen.queryByText("Permission denied (publickey).")).not.toBeInTheDocument();
});
