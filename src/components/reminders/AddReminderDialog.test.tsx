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
    priority: "medium",
    repeatRule: "once",
  });
});

it("only offers one-time, daily, and China legal workday repeat rules", () => {
  render(<AddReminderDialog onCancel={() => {}} onSave={vi.fn()} />);

  expect(screen.getByRole("option", { name: "单次提醒" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "每天" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "中国法定工作日" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "中" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "每周" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("备注")).not.toBeInTheDocument();
});

it("saves selected priority", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<AddReminderDialog onCancel={() => {}} onSave={onSave} />);

  await user.type(screen.getByLabelText("标题"), "Go sleep");
  await user.type(screen.getByLabelText("日期和时间"), "2099-01-01T22:00");
  await user.selectOptions(screen.getByLabelText("优先级"), "high");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      priority: "high",
    }),
  );
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
