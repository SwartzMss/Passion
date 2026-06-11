import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { WorkbenchHome } from "./WorkbenchHome";

it("shows workbench status summaries below search", () => {
  render(
    <WorkbenchHome
      pendingReminderCount={2}
      enabledScriptTaskCount={1}
      runningScriptTaskCount={1}
      totalScriptTaskCount={3}
    />,
  );

  expect(screen.getByLabelText("搜索状态")).toBeInTheDocument();
  expect(screen.getByText("待提醒")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
  expect(screen.getByText("启用脚本")).toBeInTheDocument();
  expect(screen.getByText("1 / 3")).toBeInTheDocument();
  expect(screen.getByText("运行中任务")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "提醒" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "开始翻译" })).not.toBeInTheDocument();
});

it("filters status summaries by search keyword", async () => {
  const user = userEvent.setup();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      enabledScriptTaskCount={2}
      runningScriptTaskCount={1}
      totalScriptTaskCount={3}
    />,
  );

  await user.type(screen.getByLabelText("搜索状态"), "运行");

  expect(screen.getByText("运行中任务")).toBeInTheDocument();
  expect(screen.queryByText("待提醒")).not.toBeInTheDocument();
  expect(screen.queryByText("启用脚本")).not.toBeInTheDocument();
});

it("shows empty search state when no summary matches", async () => {
  const user = userEvent.setup();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      enabledScriptTaskCount={0}
      runningScriptTaskCount={0}
      totalScriptTaskCount={0}
    />,
  );

  await user.type(screen.getByLabelText("搜索状态"), "不存在");

  expect(screen.getByText("没有找到相关状态")).toBeInTheDocument();
});
