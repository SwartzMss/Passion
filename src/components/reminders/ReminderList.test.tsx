import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ReminderList } from "./ReminderList";
import type { Reminder } from "../../types";

const reminder: Reminder = {
  id: "1",
  title: "Stand up",
  notes: "Stretch",
  remindAt: new Date(Date.now() + 60_000).toISOString(),
  enabled: true,
  status: "pending",
  priority: "high",
  repeatRule: "cn_workday",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  triggeredAt: null,
};

const completedReminder: Reminder = {
  ...reminder,
  id: "2",
  title: "Done task",
  notes: "Already handled",
  enabled: false,
  status: "triggered",
  priority: "medium",
  repeatRule: "once",
  triggeredAt: new Date().toISOString(),
};

it("shows the reminder management workspace when empty", async () => {
  const user = userEvent.setup();
  const onAdd = vi.fn();
  render(
    <ReminderList
      reminders={[]}
      onAdd={onAdd}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  );

  expect(screen.getByRole("heading", { name: "提醒" })).toBeInTheDocument();
  expect(screen.getByText("管理一次性提醒、周期提醒和任务通知。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "全部 0" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "待提醒 0" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已完成 0" })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("搜索提醒名称或重复规则")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "提醒列表" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "提醒详情" })).not.toBeInTheDocument();
  expect(screen.getByText("暂无提醒")).toBeInTheDocument();
  expect(screen.queryByText("添加一个提醒后，它会显示在这里。")).not.toBeInTheDocument();
  expect(screen.queryByText("还没有提醒")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "返回工作台" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "新增提醒" })).toHaveLength(1);

  await user.click(screen.getByRole("button", { name: "新增提醒" }));

  expect(onAdd).toHaveBeenCalledTimes(1);
});

it("filters reminders between all, pending, and completed views", async () => {
  const user = userEvent.setup();
  render(
    <ReminderList
      reminders={[reminder, completedReminder]}
      onAdd={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  );

  expect(screen.getByRole("button", { name: "全部 2" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "待提醒 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已完成 1" })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /Stand up/ })).toBeInTheDocument();
  expect(screen.queryByRole("row", { name: /Done task/ })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "全部 2" }));

  expect(screen.getByRole("row", { name: /Stand up/ })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /Done task/ })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "已完成 1" }));

  expect(screen.getByRole("row", { name: /Done task/ })).toBeInTheDocument();
  expect(screen.queryByRole("row", { name: /Stand up/ })).not.toBeInTheDocument();
});

it("does not show add actions inside empty filtered states", async () => {
  const user = userEvent.setup();
  render(
    <ReminderList
      reminders={[reminder]}
      onAdd={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  );

  await user.click(screen.getByRole("button", { name: "已完成 0" }));

  expect(screen.getByText("还没有已完成提醒。")).toBeInTheDocument();
  expect(screen.queryByText("添加一个提醒后，它会显示在这里。")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "新增提醒" })).toHaveLength(1);
});

it("searches reminders by title or repeat rule without rendering notes on cards", async () => {
  const user = userEvent.setup();
  render(
    <ReminderList
      reminders={[reminder, { ...reminder, id: "3", title: "Pay rent", notes: "Housing" }]}
      onAdd={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  );

  await user.type(screen.getByPlaceholderText("搜索提醒名称或重复规则"), "rent");

  expect(screen.queryByRole("row", { name: /Stand up/ })).not.toBeInTheDocument();
  expect(screen.getByRole("row", { name: /Pay rent/ })).toBeInTheDocument();
  expect(screen.queryByText("Housing")).not.toBeInTheDocument();
});

it("renders edit and delete actions directly on each card", async () => {
  const user = userEvent.setup();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  render(
    <ReminderList
      reminders={[reminder]}
      onAdd={() => {}}
      onEdit={onEdit}
      onDelete={onDelete}
    />,
  );

  expect(screen.getAllByText("法定工作日").length).toBeGreaterThan(0);
  expect(screen.getByText("高")).toBeInTheDocument();
  expect(screen.queryByText("♡")).not.toBeInTheDocument();
  expect(screen.queryByText("已启用")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "停用 Stand up" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "启用 Stand up" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "编辑 Stand up" }));
  await user.click(screen.getByRole("button", { name: "删除 Stand up" }));

  expect(onEdit).toHaveBeenCalledWith(reminder);
  expect(onDelete).toHaveBeenCalledWith("1");
});

it("shows status badges on reminder cards", () => {
  render(
    <ReminderList
      reminders={[reminder]}
      onAdd={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  );

  const list = screen.getByLabelText("提醒条目列表");
  expect(within(list).getByText("待提醒")).toBeInTheDocument();
  expect(screen.queryByLabelText("提醒详情")).not.toBeInTheDocument();
});
