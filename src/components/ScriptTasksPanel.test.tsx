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

function setupUser() {
  return userEvent.setup();
}

it("loads and shows script tasks", async () => {
  const user = setupUser();
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
  expect(screen.queryByLabelText("脚本任务详情")).not.toBeInTheDocument();
  expect(screen.getByRole("table", { name: "脚本任务列表" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "任务名" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "执行方式" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "执行命令" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "下次执行" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "状态" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
  expect(screen.getAllByText("C:\\tasks\\backup.ps1").length).toBeGreaterThan(0);
  expect(screen.getAllByText("每 15 分钟").length).toBeGreaterThan(0);
  expect(screen.queryByText("下次执行：需要后端")).not.toBeInTheDocument();
  expect(screen.getByText("总任务: 4 | 运行中: 1 | 等待执行: 1 | 已停用: 1 | 失败: 1")).toBeInTheDocument();

  await user.type(screen.getByPlaceholderText("搜索任务名称或执行命令"), "report");
  expect(screen.queryByText("备份")).not.toBeInTheDocument();
});

it("filters script tasks by status", async () => {
  const user = setupUser();
  render(<ScriptTasksPanel />);

  expect(await screen.findByRole("button", { name: "全部 4" })).toBeInTheDocument();
  expect(screen.getByText("生成报表")).toBeInTheDocument();
  expect(screen.getByText("备份")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "失败 1" }));

  expect(screen.getByText("检查更新")).toBeInTheDocument();
  expect(screen.queryByText("生成报表")).not.toBeInTheDocument();
  expect(screen.getByText("exit code 1")).toBeInTheDocument();
});

it("validates required fields before creating", async () => {
  const user = setupUser();
  render(<ScriptTasksPanel />);

  await user.click(screen.getByRole("button", { name: "新增任务" }));
  expect(screen.getByRole("dialog", { name: "新增脚本任务" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  expect(screen.getByText("任务名不能为空。")).toBeInTheDocument();
});

it("creates a script task", async () => {
  const user = setupUser();
  render(<ScriptTasksPanel />);

  await user.click(screen.getByRole("button", { name: "新增任务" }));
  expect(screen.getByRole("button", { name: "关闭新增脚本任务" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "选择脚本" })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("任务名"), "备份");
  expect(screen.getByRole("option", { name: "周期" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("执行命令"), "C:\\tasks\\selected.ps1 --config C:\\cfg\\a.json");
  await user.clear(screen.getByLabelText("间隔分钟数"));
  await user.type(screen.getByLabelText("间隔分钟数"), "15");
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  const api = await import("../lib/api");
  expect(api.createScriptTask).toHaveBeenCalledWith({
    name: "备份",
    scriptPath: "C:\\tasks\\selected.ps1",
    scriptArgs: "--config C:\\cfg\\a.json",
    scheduleType: "interval",
    intervalMinutes: 15,
    timeOfDay: null,
    weekdays: null,
    enabled: true,
  });
});

it("creates daily and weekly script tasks", async () => {
  const user = setupUser();
  render(<ScriptTasksPanel />);

  await user.click(screen.getByRole("button", { name: "新增任务" }));
  await user.type(screen.getByLabelText("任务名"), "日报");
  await user.type(screen.getByLabelText("执行命令"), "C:\\tasks\\daily.ps1");
  await user.selectOptions(screen.getByLabelText("执行方式"), "daily");
  await user.clear(screen.getByLabelText("执行时间"));
  await user.type(screen.getByLabelText("执行时间"), "09:30");
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  const api = await import("../lib/api");
  expect(api.createScriptTask).toHaveBeenLastCalledWith({
    name: "日报",
    scriptPath: "C:\\tasks\\daily.ps1",
    scriptArgs: null,
    scheduleType: "daily",
    intervalMinutes: null,
    timeOfDay: "09:30",
    weekdays: null,
    enabled: true,
  });

  await user.click(screen.getByRole("button", { name: "新增任务" }));
  await user.type(screen.getByLabelText("任务名"), "周报");
  await user.type(screen.getByLabelText("执行命令"), "C:\\tasks\\weekly.ps1");
  await user.selectOptions(screen.getByLabelText("执行方式"), "weekly");
  await user.clear(screen.getByLabelText("执行时间"));
  await user.type(screen.getByLabelText("执行时间"), "18:00");
  await user.click(screen.getByLabelText("周一"));
  await user.click(screen.getByLabelText("周五"));
  expect(screen.getByLabelText("周一").closest("label")).toHaveClass("selected");
  expect(screen.getByLabelText("周五").closest("label")).toHaveClass("selected");
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  expect(api.createScriptTask).toHaveBeenLastCalledWith({
    name: "周报",
    scriptPath: "C:\\tasks\\weekly.ps1",
    scriptArgs: null,
    scheduleType: "weekly",
    intervalMinutes: null,
    timeOfDay: "18:00",
    weekdays: [1, 5],
    enabled: true,
  });
});

it("creates a task from a full command string", async () => {
  const user = setupUser();
  render(<ScriptTasksPanel />);

  await user.click(screen.getByRole("button", { name: "新增任务" }));
  await user.type(screen.getByLabelText("任务名"), "Python任务");
  await user.type(
    screen.getByLabelText("执行命令"),
    '"C:\\Program Files\\Python\\python.exe" "C:\\tasks\\hello world.py" --port 7890',
  );
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  const api = await import("../lib/api");
  expect(api.createScriptTask).toHaveBeenLastCalledWith({
    name: "Python任务",
    scriptPath: "C:\\Program Files\\Python\\python.exe",
    scriptArgs: '"C:\\tasks\\hello world.py" --port 7890',
    scheduleType: "interval",
    intervalMinutes: 15,
    timeOfDay: null,
    weekdays: null,
    enabled: true,
  });
});

it("runs, toggles, and deletes a script task", async () => {
  const user = setupUser();
  render(<ScriptTasksPanel />);

  await screen.findByRole("button", { name: "运行中 1" });
  const firstRow = screen.getByRole("row", { name: /备份/ });
  await user.click(within(firstRow).getByRole("button", { name: "立即运行" }));
  await user.click(within(firstRow).getByLabelText("更多操作"));
  expect(within(firstRow).queryByRole("button", { name: "查看日志" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("heading", { name: "脚本任务列表" }));
  expect(within(firstRow).queryByRole("button", { name: "停用任务" })).not.toBeInTheDocument();
  await user.click(within(firstRow).getByLabelText("更多操作"));
  await user.click(within(firstRow).getByRole("button", { name: "停用任务" }));
  await user.click(within(firstRow).getByLabelText("更多操作"));
  await user.click(within(firstRow).getByRole("button", { name: "删除任务" }));

  const api = await import("../lib/api");
  expect(api.runScriptTaskNow).toHaveBeenCalledWith("task-1");
  expect(api.setScriptTaskEnabled).toHaveBeenCalledWith("task-1", false);
  expect(api.deleteScriptTask).toHaveBeenCalledWith("task-1");
});
