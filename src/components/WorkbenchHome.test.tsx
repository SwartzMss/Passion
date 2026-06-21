import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WorkbenchHome } from "./WorkbenchHome";

const defaultProps = {
  pendingReminderCount: 2,
  enabledScriptTaskCount: 1,
  runningScriptTaskCount: 1,
  totalScriptTaskCount: 3,
  onOpenReminders: vi.fn(),
  onAddReminder: vi.fn(),
  onOpenTranslation: vi.fn(),
  onOpenNetworkDiagnostics: vi.fn(),
  onOpenDownloader: vi.fn(),
  onOpenSystemMonitor: vi.fn(),
  onOpenScriptTasks: vi.fn(),
  onOpenUtilities: vi.fn(),
};

it("shows the workbench dashboard", async () => {
  const { container } = render(
    <WorkbenchHome {...defaultProps} />,
  );

  expect(screen.getByRole("heading", { name: "工作台" })).toBeInTheDocument();
  expect(
    screen.getByText("欢迎使用 Passion，快速查看任务状态并启动常用工具。"),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("搜索工具")).toBeInTheDocument();
  expect(screen.getByText("Ctrl + K")).toBeInTheDocument();

  expect(screen.getByText("待提醒")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
  expect(screen.getByText("下载中")).toBeInTheDocument();
  expect(screen.getByText("运行中脚本")).toBeInTheDocument();
  expect(screen.getByText("系统状态")).toBeInTheDocument();
  expect(container.querySelectorAll(".workbench-status-icon svg")).toHaveLength(4);
  expect(screen.queryByText("快速操作")).not.toBeInTheDocument();
  expect(screen.queryByText("即将发生")).not.toBeInTheDocument();
  expect(screen.queryByText("最近活动")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "新增脚本任务" })).not.toBeInTheDocument();
});

it("searches tools without showing the old card grid", async () => {
  const user = userEvent.setup();
  const onOpenNetworkDiagnostics = vi.fn();
  render(
    <WorkbenchHome
      {...defaultProps}
      onOpenNetworkDiagnostics={onOpenNetworkDiagnostics}
    />,
  );

  await user.type(screen.getByLabelText("搜索工具"), "端口");

  expect(screen.getByLabelText("工具搜索结果")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "网络检测" })).toBeInTheDocument();
  expect(screen.queryByText("待提醒")).not.toBeInTheDocument();
  expect(screen.queryByText("快速操作")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "开始检测" }));

  expect(onOpenNetworkDiagnostics).toHaveBeenCalledOnce();
});

it("shows empty search state when no tool matches", async () => {
  const user = userEvent.setup();
  render(<WorkbenchHome {...defaultProps} />);

  await user.type(screen.getByLabelText("搜索工具"), "不存在");

  expect(screen.getByText("没有找到相关工具")).toBeInTheDocument();
});
