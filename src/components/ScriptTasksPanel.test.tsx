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

vi.mock("../lib/api", () => ({
  listScriptTasks: vi.fn(async () => [sampleTask, runningTask]),
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

  await screen.findByRole("button", { name: "运行中 1" });
  await user.click(screen.getByRole("button", { name: "已结束 1" }));

  const detail = screen.getByLabelText("脚本任务详情");
  expect(screen.getByRole("button", { name: "备份" })).toBeInTheDocument();
  expect(within(detail).getByText("C:\\tasks\\backup.ps1")).toBeInTheDocument();
  expect(within(detail).getByText("每 15 分钟")).toBeInTheDocument();
  expect(within(detail).getByText("stdout")).toBeInTheDocument();
  expect(within(detail).getByText("ok")).toBeInTheDocument();
});

it("filters script tasks by running and finished status", async () => {
  const user = userEvent.setup();
  render(<ScriptTasksPanel />);

  expect(await screen.findByRole("button", { name: "运行中 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已结束 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成报表" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "备份" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "已结束 1" }));

  expect(screen.getByRole("button", { name: "备份" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "生成报表" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("脚本任务详情")).toHaveTextContent("已结束");
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

  await user.type(screen.getByLabelText("任务名"), "日报");
  await user.type(screen.getByLabelText("脚本路径"), "C:\\tasks\\daily.ps1");
  await user.selectOptions(screen.getByLabelText("执行方式"), "daily");
  await user.clear(screen.getByLabelText("执行时间"));
  await user.type(screen.getByLabelText("执行时间"), "09:30");
  await user.click(screen.getByRole("button", { name: "新增任务" }));

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

  await user.type(screen.getByLabelText("任务名"), "周报");
  await user.type(screen.getByLabelText("脚本路径"), "C:\\tasks\\weekly.ps1");
  await user.selectOptions(screen.getByLabelText("执行方式"), "weekly");
  await user.clear(screen.getByLabelText("执行时间"));
  await user.type(screen.getByLabelText("执行时间"), "18:00");
  await user.click(screen.getByLabelText("周一"));
  await user.click(screen.getByLabelText("周五"));
  await user.click(screen.getByRole("button", { name: "新增任务" }));

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
  expect(api.runScriptTaskNow).toHaveBeenCalledWith("task-running");
  expect(api.setScriptTaskEnabled).toHaveBeenCalledWith("task-running", false);
  expect(api.deleteScriptTask).toHaveBeenCalledWith("task-running");
});
