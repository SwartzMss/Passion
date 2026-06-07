import { render, screen } from "@testing-library/react";
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

it("shows empty state", () => {
  render(
    <ReminderList
      reminders={[]}
      onAdd={() => {}}
      onToggle={() => {}}
      onDelete={() => {}}
    />,
  );

  expect(screen.getByText("还没有提醒")).toBeInTheDocument();
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
