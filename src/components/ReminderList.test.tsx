import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ReminderList } from "./ReminderList";
import type { Reminder } from "../types";

const reminder: Reminder = {
  id: "1",
  title: "Stand up",
  notes: "Stretch",
  remindAt: new Date(Date.now() + 60_000).toISOString(),
  enabled: true,
  status: "pending",
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
  repeatRule: "once",
  triggeredAt: new Date().toISOString(),
};

it("shows the reminder workspace when empty", () => {
  render(
    <ReminderList
      reminders={[]}
      onAdd={() => {}}
      onToggle={() => {}}
      onDelete={() => {}}
    />,
  );

  expect(screen.getByRole("button", { name: "当前提醒 0" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已完成提醒 0" })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("搜索提醒名称、备注或规则")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "新增提醒" })).toBeInTheDocument();
  expect(screen.getByText("当前没有提醒。")).toBeInTheDocument();
  expect(screen.getByText("左侧列表没有可显示的提醒。")).toBeInTheDocument();
  expect(screen.queryByText("还没有提醒")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "返回工作台" })).not.toBeInTheDocument();
});

it("filters reminders between current and completed views", async () => {
  const user = userEvent.setup();
  render(
    <ReminderList
      reminders={[reminder, completedReminder]}
      onAdd={() => {}}
      onToggle={() => {}}
      onDelete={() => {}}
    />,
  );

  expect(screen.getByRole("button", { name: "Stand up" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Done task" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "已完成提醒 1" }));

  expect(screen.getByRole("button", { name: "Done task" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Stand up" })).not.toBeInTheDocument();
});

it("searches reminders and shows the selected reminder detail", async () => {
  const user = userEvent.setup();
  render(
    <ReminderList
      reminders={[reminder, { ...reminder, id: "3", title: "Pay rent", notes: "Housing" }]}
      onAdd={() => {}}
      onToggle={() => {}}
      onDelete={() => {}}
    />,
  );

  await user.type(screen.getByPlaceholderText("搜索提醒名称、备注或规则"), "rent");
  await user.click(screen.getByRole("button", { name: "Pay rent" }));

  expect(screen.queryByRole("button", { name: "Stand up" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Pay rent" })).toBeInTheDocument();
  expect(screen.getByText("Housing")).toBeInTheDocument();
});

it("renders reminder actions from detail panel", async () => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  const onDelete = vi.fn();
  render(
    <ReminderList
      reminders={[reminder]}
      onAdd={() => {}}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  );

  expect(screen.getAllByText("中国法定工作日").length).toBeGreaterThan(0);

  await user.click(screen.getByRole("button", { name: "停用 Stand up" }));
  await user.click(screen.getByRole("button", { name: "删除 Stand up" }));

  expect(onToggle).toHaveBeenCalledWith("1", false);
  expect(onDelete).toHaveBeenCalledWith("1");
});

it("keeps status out of compact reminder rows", () => {
  render(
    <ReminderList
      reminders={[reminder]}
      onAdd={() => {}}
      onToggle={() => {}}
      onDelete={() => {}}
    />,
  );

  const list = screen.getByLabelText("提醒列表");
  expect(within(list).queryByText("待提醒")).not.toBeInTheDocument();
  expect(screen.getByLabelText("提醒详情")).toHaveTextContent("待提醒");
});
