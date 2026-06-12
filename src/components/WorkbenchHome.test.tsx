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
};

it("shows workbench status summaries below search", () => {
  render(<WorkbenchHome {...defaultProps} />);

  expect(screen.getByLabelText("搜索工具")).toBeInTheDocument();
  expect(screen.getByText("待提醒")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
  expect(screen.getByText("启用脚本")).toBeInTheDocument();
  expect(screen.getByText("1 / 3")).toBeInTheDocument();
  expect(screen.getByText("运行中任务")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "提醒" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "开始翻译" })).not.toBeInTheDocument();
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
  expect(screen.queryByText("启用脚本")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "开始检测" }));

  expect(onOpenNetworkDiagnostics).toHaveBeenCalledOnce();
});

it("shows empty search state when no tool matches", async () => {
  const user = userEvent.setup();
  render(<WorkbenchHome {...defaultProps} />);

  await user.type(screen.getByLabelText("搜索工具"), "不存在");

  expect(screen.getByText("没有找到相关工具")).toBeInTheDocument();
});
