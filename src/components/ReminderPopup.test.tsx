import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ReminderPopup } from "./ReminderPopup";

const reminder = {
  id: "reminder-1",
  title: "测试提醒",
  notes: null,
  remindAt: "2026-06-13T00:34:00.000Z",
  enabled: true,
  status: "triggered" as const,
  priority: "medium" as const,
  repeatRule: "once" as const,
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:34:00.000Z",
  triggeredAt: "2026-06-13T00:34:00.000Z",
};

it("shows a compact reminder toast and closes from either action", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const { container } = render(<ReminderPopup reminder={reminder} onClose={onClose} />);

  expect(screen.getByRole("dialog", { name: "提醒" })).toBeInTheDocument();
  expect(screen.getByText("Passion")).toBeInTheDocument();
  expect(container.querySelector(".reminder-toast-brand img")).toBeInTheDocument();
  expect(screen.getByText("测试提醒")).toBeInTheDocument();
  expect(screen.getByText(/今天|2026/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "完成" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "关闭提醒" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "知道了" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "完成" }));
  await user.click(screen.getByRole("button", { name: "关闭提醒" }));

  expect(onClose).toHaveBeenCalledTimes(2);
});
