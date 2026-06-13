import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ScriptTasksPanel } from "./ScriptTasksPanel";

const sampleTask = {
  id: "task-1",
  name: "备份",
  scriptPath: "C:\\tasks\\backup.ps1",
  scheduleType: "interval",
  intervalMinutes: 15,
  timeOfDay: null,
  weekdays: null,
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

const runningTask = {
  ...sampleTask,
  id: "task-running",
  name: "生成报表",
  lastStartedAt: "2026-06-07T02:00:00Z",
  lastFinishedAt: null,
  lastExitCode: null,
  lastStdout: null,
};

const failedTask = {
  ...sampleTask,
  id: "task-failed",
  name: "检查更新",
  lastExitCode: 1,
  lastStdout: null,
  lastStderr: "failed",
  lastError: "exit code 1",
};

const disabledTask = {
  ...sampleTask,
  id: "task-disabled",
  name: "同步文件",
  enabled: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastExitCode: null,
  lastStdout: null,
};

vi.mock("../lib/api", () => ({
  listScriptTasks: vi.fn(async () => [
    sampleTask,
    runningTask,
    failedTask,
    disabledTask,
  ]),
  createScriptTask: vi.fn(async () => sampleTask),
  setScriptTaskEnabled: vi.fn(async () => ({ ...sampleTask, enabled: false })),
  deleteScriptTask: vi.fn(async () => undefined),
  runScriptTaskNow: vi.fn(async () => ({ ...sampleTask, lastStdout: "ran" })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it("loads and shows script tasks", async () => {
  const user = userEvent.setup();
  render(<ScriptTasksPanel />);

  expect(screen.getByRole("heading", { name: "脚本任务" })).toBeInTheDocument();
  expect(screen.getByText("按固定间隔执行本机脚本，应用运行时生效。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "使用说明" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "新增任务" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "全部 4" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "运行中 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "等待执行 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已停用 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "失败 1" })).toBeInTheDocument();

  const detail = screen.getByLabelText("脚本任务详情");
  expect(screen.getByRole("button", { name: "备份" })).toBeInTheDocument();
  expect(within(detail).getByText("C:\\tasks\\backup.ps1")).toBeInTheDocument();
  expect(within(detail).getByText("每 15 分钟")).toBeInTheDocument();
  expect(within(detail).getByText("执行日志")).toBeInTheDocument();
  expect(within(detail).getByText("ok")).toBeInTheDocument();

  await user.type(screen.getByPlaceholderText("搜索任务名称或脚本路径"), "report");
  expect(screen.queryByRole("button", { name: "备份" })).not.toBeInTheDocument();
});

it("filters script tasks by status", async () => {
  const user = userEvent.setup();
  render(<ScriptTasksPanel />);

  expect(await screen.findByRole("button", { name: "全部 4" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成报表" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "备份" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "失败 1" }));

  expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "生成报表" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("脚本任务详情")).toHaveTextContent("失败");
});

it("validates required fields before creating", async () => {
  const user = userEvent.setup();
  render(<ScriptTasksPanel />);

  await user.click(screen.getByRole("button", { name: "新增任务" }));
  expect(screen.getByRole("dialog", { name: "新增脚本任务" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  expect(screen.getByText("任务名不能为空。")).toBeInTheDocument();
});

it("creates a script task", async () => {
  const user = userEvent.setup();
  render(<ScriptTasksPanel />);

  await user.click(screen.getByRole("button", { name: "新增任务" }));
  await user.type(screen.getByLabelText("任务名"), "备份");
  await user.type(screen.getByLabelText("脚本路径"), "C:\\tasks\\backup.ps1");
  await user.clear(screen.getByLabelText("间隔分钟数"));
  await user.type(screen.getByLabelText("间隔分钟数"), "15");
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  const api = await import("../lib/api");
  expect(api.createScriptTask).toHaveBeenCalledWith({
    name: "备份",
    scriptPath: "C:\\tasks\\backup.ps1",
    scheduleType: "interval",
    intervalMinutes: 15,
    timeOfDay: null,
    weekdays: null,
    enabled: true,
  });
});

it("creates daily and weekly script tasks", async () => {
  const user = userEvent.setup();
  render(<ScriptTasksPanel />);

  await user.click(screen.getByRole("button", { name: "新增任务" }));
  await user.type(screen.getByLabelText("任务名"), "日报");
  await user.type(screen.getByLabelText("脚本路径"), "C:\\tasks\\daily.ps1");
  await user.selectOptions(screen.getByLabelText("执行方式"), "daily");
  await user.clear(screen.getByLabelText("执行时间"));
  await user.type(screen.getByLabelText("执行时间"), "09:30");
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  const api = await import("../lib/api");
  expect(api.createScriptTask).toHaveBeenLastCalledWith({
    name: "日报",
    scriptPath: "C:\\tasks\\daily.ps1",
    scheduleType: "daily",
    intervalMinutes: null,
    timeOfDay: "09:30",
    weekdays: null,
    enabled: true,
  });

  await user.click(screen.getByRole("button", { name: "新增任务" }));
  await user.type(screen.getByLabelText("任务名"), "周报");
  await user.type(screen.getByLabelText("脚本路径"), "C:\\tasks\\weekly.ps1");
  await user.selectOptions(screen.getByLabelText("执行方式"), "weekly");
  await user.clear(screen.getByLabelText("执行时间"));
  await user.type(screen.getByLabelText("执行时间"), "18:00");
  await user.click(screen.getByLabelText("周一"));
  await user.click(screen.getByLabelText("周五"));
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  expect(api.createScriptTask).toHaveBeenLastCalledWith({
    name: "周报",
    scriptPath: "C:\\tasks\\weekly.ps1",
    scheduleType: "weekly",
    intervalMinutes: null,
    timeOfDay: "18:00",
    weekdays: [1, 5],
    enabled: true,
  });
});

it("runs, toggles, and deletes a script task", async () => {
  const user = userEvent.setup();
  render(<ScriptTasksPanel />);

  await screen.findByRole("button", { name: "运行中 1" });
  await user.click(screen.getByRole("button", { name: "立即运行" }));
  await user.click(screen.getByRole("button", { name: "停用" }));
  await user.click(screen.getByRole("button", { name: "删除" }));

  const api = await import("../lib/api");
  expect(api.runScriptTaskNow).toHaveBeenCalledWith("task-1");
  expect(api.setScriptTaskEnabled).toHaveBeenCalledWith("task-1", false);
  expect(api.deleteScriptTask).toHaveBeenCalledWith("task-1");
});
