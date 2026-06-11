import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WorkbenchHome } from "./WorkbenchHome";

it("shows assistant feature cards", () => {
  render(
    <WorkbenchHome
      pendingReminderCount={2}
      enabledScriptTaskCount={1}
      runningScriptTaskCount={1}
      totalScriptTaskCount={3}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={() => {}}
    />,
  );

  expect(screen.queryByRole("button", { name: "设置" })).not.toBeInTheDocument();
  expect(screen.getByText("待提醒")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
  expect(screen.getByText("启用脚本")).toBeInTheDocument();
  expect(screen.getByText("1 / 3")).toBeInTheDocument();
  expect(screen.getByText("运行中任务")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "提醒" })).toBeInTheDocument();
  expect(screen.getByText(/2 个待提醒/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "翻译" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "网络检测" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "下载工具" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "系统监控" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "脚本任务" })).toBeInTheDocument();
});

it("opens translation from the workbench", async () => {
  const user = userEvent.setup();
  const onOpenTranslation = vi.fn();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      enabledScriptTaskCount={0}
      runningScriptTaskCount={0}
      totalScriptTaskCount={0}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={onOpenTranslation}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={() => {}}
    />,
  );

  await user.click(screen.getByRole("button", { name: "开始翻译" }));

  expect(onOpenTranslation).toHaveBeenCalledOnce();
});

it("opens network diagnostics from the workbench", async () => {
  const user = userEvent.setup();
  const onOpenNetworkDiagnostics = vi.fn();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      enabledScriptTaskCount={0}
      runningScriptTaskCount={0}
      totalScriptTaskCount={0}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={onOpenNetworkDiagnostics}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={() => {}}
    />,
  );

  await user.click(screen.getByRole("button", { name: "开始检测" }));

  expect(onOpenNetworkDiagnostics).toHaveBeenCalledOnce();
});

it("opens downloader from the workbench", async () => {
  const user = userEvent.setup();
  const onOpenDownloader = vi.fn();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      enabledScriptTaskCount={0}
      runningScriptTaskCount={0}
      totalScriptTaskCount={0}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={onOpenDownloader}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={() => {}}
    />,
  );

  await user.click(screen.getByRole("button", { name: "开始下载" }));

  expect(onOpenDownloader).toHaveBeenCalledOnce();
});

it("opens system monitor from the workbench", async () => {
  const user = userEvent.setup();
  const onOpenSystemMonitor = vi.fn();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      enabledScriptTaskCount={0}
      runningScriptTaskCount={0}
      totalScriptTaskCount={0}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={onOpenSystemMonitor}
      onOpenScriptTasks={() => {}}
    />,
  );

  await user.click(screen.getByRole("button", { name: "查看状态" }));

  expect(onOpenSystemMonitor).toHaveBeenCalledOnce();
});

it("opens script tasks from the workbench", async () => {
  const user = userEvent.setup();
  const onOpenScriptTasks = vi.fn();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      enabledScriptTaskCount={0}
      runningScriptTaskCount={0}
      totalScriptTaskCount={0}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={onOpenScriptTasks}
    />,
  );

  await user.click(screen.getByRole("button", { name: "管理任务" }));

  expect(onOpenScriptTasks).toHaveBeenCalledOnce();
});

it("filters feature cards by search keyword", async () => {
  const user = userEvent.setup();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      enabledScriptTaskCount={0}
      runningScriptTaskCount={0}
      totalScriptTaskCount={0}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={() => {}}
    />,
  );

  await user.type(screen.getByLabelText("搜索功能"), "端口");

  expect(screen.getByRole("heading", { name: "网络检测" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "翻译" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "脚本任务" })).not.toBeInTheDocument();
});

it("shows empty search state when no feature matches", async () => {
  const user = userEvent.setup();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      enabledScriptTaskCount={0}
      runningScriptTaskCount={0}
      totalScriptTaskCount={0}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={() => {}}
    />,
  );

  await user.type(screen.getByLabelText("搜索功能"), "不存在");

  expect(screen.getByText("没有找到相关功能")).toBeInTheDocument();
});
