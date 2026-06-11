import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AddReminderDialog } from "./AddReminderDialog";

it("rejects empty title", async () => {
  const user = userEvent.setup();
  render(<AddReminderDialog onCancel={() => {}} onSave={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(screen.getByText("请输入提醒标题。")).toBeInTheDocument();
});

it("saves valid reminder", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<AddReminderDialog onCancel={() => {}} onSave={onSave} />);

  await user.type(screen.getByLabelText("标题"), "Pay rent");
  await user.type(screen.getByLabelText("日期和时间"), "2099-01-01T09:00");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(onSave).toHaveBeenCalledWith({
    title: "Pay rent",
    notes: null,
    remindAt: new Date("2099-01-01T09:00").toISOString(),
    repeatRule: "once",
  });
});

it("saves China legal workday reminders", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<AddReminderDialog onCancel={() => {}} onSave={onSave} />);

  await user.type(screen.getByLabelText("标题"), "Standup");
  await user.selectOptions(screen.getByLabelText("重复规则"), "cn_workday");
  await user.type(screen.getByLabelText("提醒时间"), "09:00");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      repeatRule: "cn_workday",
    }),
  );
});

it("saves daily reminders", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<AddReminderDialog onCancel={() => {}} onSave={onSave} />);

  await user.type(screen.getByLabelText("标题"), "Daily standup");
  await user.selectOptions(screen.getByLabelText("重复规则"), "daily");
  expect(screen.queryByLabelText("日期和时间")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("提醒时间"), "09:00");
  await user.click(screen.getByRole("button", { name: "保存" }));

  const saved = onSave.mock.calls[0][0];
  const remindAt = new Date(saved.remindAt);
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      repeatRule: "daily",
    }),
  );
  expect(remindAt.getHours()).toBe(9);
  expect(remindAt.getMinutes()).toBe(0);
});

it("saves weekly reminders with selected weekdays", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<AddReminderDialog onCancel={() => {}} onSave={onSave} />);

  await user.type(screen.getByLabelText("标题"), "Team sync");
  await user.selectOptions(screen.getByLabelText("重复规则"), "weekly");
  expect(screen.queryByLabelText("日期和时间")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("提醒时间"), "09:30");
  await user.click(screen.getByLabelText("周一"));
  await user.click(screen.getByLabelText("周三"));
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      repeatRule: "weekly:1,3",
    }),
  );
});

it("requires at least one weekday for weekly reminders", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<AddReminderDialog onCancel={() => {}} onSave={onSave} />);

  await user.type(screen.getByLabelText("标题"), "Team sync");
  await user.selectOptions(screen.getByLabelText("重复规则"), "weekly");
  await user.type(screen.getByLabelText("提醒时间"), "09:00");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(screen.getByText("请选择至少一个星期几。")).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});
