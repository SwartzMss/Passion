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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  triggeredAt: null,
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
});

it("renders reminder actions", async () => {
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

  await user.click(screen.getByRole("button", { name: "停用 Stand up" }));
  await user.click(screen.getByRole("button", { name: "删除 Stand up" }));

  expect(onToggle).toHaveBeenCalledWith("1", false);
  expect(onDelete).toHaveBeenCalledWith("1");
});
