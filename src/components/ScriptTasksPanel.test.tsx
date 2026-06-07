import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ScriptTasksPanel } from "./ScriptTasksPanel";

const sampleTask = {
  id: "task-1",
  name: "备份",
  scriptPath: "C:\\tasks\\backup.ps1",
  intervalMinutes: 15,
  enabled: true,
  lastStartedAt: "2026-06-07T01:00:00Z",
  lastFinishedAt: "2026-06-07T01:00:02Z",
  lastExitCode: 0,
  lastStdout: "ok",
  lastStderr: null,
  lastError: null,
  createdAt: "2026-06-07T00:00:00Z",
  updatedAt: "2026-06-07T01:00:02Z",
};

vi.mock("../lib/api", () => ({
  listScriptTasks: vi.fn(async () => [sampleTask]),
  createScriptTask: vi.fn(async () => sampleTask),
  setScriptTaskEnabled: vi.fn(async () => ({ ...sampleTask, enabled: false })),
  deleteScriptTask: vi.fn(async () => undefined),
  runScriptTaskNow: vi.fn(async () => ({ ...sampleTask, lastStdout: "ran" })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it("loads and shows script tasks", async () => {
  render(<ScriptTasksPanel />);

  expect(await screen.findByText("备份")).toBeInTheDocument();
  expect(screen.getByText("C:\\tasks\\backup.ps1")).toBeInTheDocument();
  expect(screen.getByText("每 15 分钟")).toBeInTheDocument();
  expect(screen.getByText("stdout")).toBeInTheDocument();
  expect(screen.getByText("ok")).toBeInTheDocument();
});

it("validates required fields before creating", async () => {
  const user = userEvent.setup();
  render(<ScriptTasksPanel />);

  await user.click(screen.getByRole("button", { name: "新增任务" }));

  expect(screen.getByText("任务名不能为空。")).toBeInTheDocument();
});

it("creates a script task", async () => {
  const user = userEvent.setup();
  render(<ScriptTasksPanel />);

  await user.type(screen.getByLabelText("任务名"), "备份");
  await user.type(screen.getByLabelText("脚本路径"), "C:\\tasks\\backup.ps1");
  await user.clear(screen.getByLabelText("间隔分钟数"));
  await user.type(screen.getByLabelText("间隔分钟数"), "15");
  await user.click(screen.getByRole("button", { name: "新增任务" }));

  const api = await import("../lib/api");
  expect(api.createScriptTask).toHaveBeenCalledWith({
    name: "备份",
    scriptPath: "C:\\tasks\\backup.ps1",
    intervalMinutes: 15,
    enabled: true,
  });
});

it("runs, toggles, and deletes a script task", async () => {
  const user = userEvent.setup();
  render(<ScriptTasksPanel />);

  await screen.findByText("备份");
  await user.click(screen.getByRole("button", { name: "立即运行" }));
  await user.click(screen.getByRole("button", { name: "停用" }));
  await user.click(screen.getByRole("button", { name: "删除" }));

  const api = await import("../lib/api");
  expect(api.runScriptTaskNow).toHaveBeenCalledWith("task-1");
  expect(api.setScriptTaskEnabled).toHaveBeenCalledWith("task-1", false);
  expect(api.deleteScriptTask).toHaveBeenCalledWith("task-1");
});
