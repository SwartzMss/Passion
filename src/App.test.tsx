import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./lib/api", () => ({
  listReminders: vi.fn(async () => []),
  createReminder: vi.fn(),
  deleteReminder: vi.fn(),
  toggleReminder: vi.fn(),
}));

vi.mock("./lib/events", () => ({
  onReminderTriggered: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    hide: vi.fn(async () => undefined),
    minimize: vi.fn(async () => undefined),
    startDragging: vi.fn(async () => undefined),
  }),
}));

it("shows a left navigation without removing workbench search", async () => {
  render(<App />);

  await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
  const navigation = screen.getByRole("navigation");

  expect(within(navigation).getByRole("button", { name: "工作台" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(within(navigation).getByRole("button", { name: "提醒" })).toBeInTheDocument();
  expect(within(navigation).getByRole("button", { name: "翻译" })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("搜索功能，例如：端口、翻译、脚本、下载")).toBeInTheDocument();
});

it("switches features from the left navigation", async () => {
  const user = userEvent.setup();
  render(<App />);
  const navigation = screen.getByRole("navigation");

  await user.click(within(navigation).getByRole("button", { name: "翻译" }));

  expect(within(navigation).getByRole("button", { name: "翻译" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByText("原文")).toBeInTheDocument();
  expect(
    screen.queryByPlaceholderText("搜索功能，例如：端口、翻译、脚本、下载"),
  ).not.toBeInTheDocument();
});
