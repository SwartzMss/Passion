import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ReminderWindow } from "./ReminderWindow";
import * as api from "../lib/api";

vi.mock("../lib/api", () => ({
  listReminders: vi.fn(),
}));

const reminder = {
  id: "reminder-1",
  title: "独立提醒",
  notes: null,
  remindAt: "2026-06-13T07:11:00.000Z",
  enabled: true,
  status: "triggered" as const,
  priority: "medium" as const,
  repeatRule: "once" as const,
  createdAt: "2026-06-13T07:00:00.000Z",
  updatedAt: "2026-06-13T07:11:00.000Z",
  triggeredAt: "2026-06-13T07:11:00.000Z",
};

beforeEach(() => {
  vi.mocked(api.listReminders).mockReset();
});

it("loads the reminder by id and renders it in a centered window surface", async () => {
  vi.mocked(api.listReminders).mockResolvedValue([reminder]);

  render(<ReminderWindow reminderId="reminder-1" onClose={vi.fn()} />);

  await waitFor(() => {
    expect(screen.getByText("独立提醒")).toBeInTheDocument();
  });
  expect(screen.getByTestId("reminder-window")).toHaveClass("reminder-window");
  expect(screen.getByRole("button", { name: "完成" })).toBeInTheDocument();
});
