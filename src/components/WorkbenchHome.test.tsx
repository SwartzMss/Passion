import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WorkbenchHome } from "./WorkbenchHome";

it("shows assistant feature cards", () => {
  render(
    <WorkbenchHome
      pendingReminderCount={2}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={() => {}}
      onOpenSettings={() => {}}
    />,
  );

  expect(screen.getByText("提醒")).toBeInTheDocument();
  expect(screen.getByText("2 个待提醒")).toBeInTheDocument();
  expect(screen.getByText("翻译")).toBeInTheDocument();
  expect(screen.getByText("网络检测")).toBeInTheDocument();
  expect(screen.getByText("下载工具")).toBeInTheDocument();
  expect(screen.getByText("系统监控")).toBeInTheDocument();
  expect(screen.getByText("脚本任务")).toBeInTheDocument();
});

it("opens translation from the workbench", async () => {
  const user = userEvent.setup();
  const onOpenTranslation = vi.fn();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={onOpenTranslation}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={() => {}}
      onOpenSettings={() => {}}
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
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={onOpenNetworkDiagnostics}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={() => {}}
      onOpenSettings={() => {}}
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
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={onOpenDownloader}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={() => {}}
      onOpenSettings={() => {}}
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
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={onOpenSystemMonitor}
      onOpenScriptTasks={() => {}}
      onOpenSettings={() => {}}
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
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={() => {}}
      onOpenDownloader={() => {}}
      onOpenSystemMonitor={() => {}}
      onOpenScriptTasks={onOpenScriptTasks}
      onOpenSettings={() => {}}
    />,
  );

  await user.click(screen.getByRole("button", { name: "管理任务" }));

  expect(onOpenScriptTasks).toHaveBeenCalledOnce();
});
