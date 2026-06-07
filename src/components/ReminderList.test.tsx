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

it("shows empty state", () => {
  render(
    <ReminderList
      reminders={[]}
      onBack={() => {}}
      onAdd={() => {}}
      onToggle={() => {}}
      onDelete={() => {}}
    />,
  );

  expect(screen.getByText("还没有提醒")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回工作台" })).toBeInTheDocument();
});

it("renders reminder actions", async () => {
  const user = userEvent.setup();
  const onBack = vi.fn();
  const onToggle = vi.fn();
  const onDelete = vi.fn();
  render(
    <ReminderList
      reminders={[reminder]}
      onBack={onBack}
      onAdd={() => {}}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  );

  expect(screen.getByText("中国法定工作日")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "返回工作台" }));
  await user.click(screen.getByRole("button", { name: "停用 Stand up" }));
  await user.click(screen.getByRole("button", { name: "删除 Stand up" }));

  expect(onBack).toHaveBeenCalled();
  expect(onToggle).toHaveBeenCalledWith("1", false);
  expect(onDelete).toHaveBeenCalledWith("1");
});
