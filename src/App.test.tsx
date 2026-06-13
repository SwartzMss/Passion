import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "./App";
import { APP_VERSION } from "./version";

vi.mock("./lib/api", () => ({
  listReminders: vi.fn(async () => []),
  listScriptTasks: vi.fn(async () => [
    {
      id: "script-1",
      name: "Backup",
      scriptPath: "C:\\tasks\\backup.ps1",
      intervalMinutes: 15,
      enabled: true,
      lastStartedAt: "2026-06-11T10:00:00.000Z",
      lastFinishedAt: null,
      lastExitCode: null,
      lastStdout: null,
      lastStderr: null,
      lastError: null,
      createdAt: "2026-06-11T09:00:00.000Z",
      updatedAt: "2026-06-11T09:00:00.000Z",
    },
  ]),
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

  expect(screen.getAllByText("Passion")).toHaveLength(1);
  expect(screen.getByLabelText("应用版本")).toHaveTextContent(`v${APP_VERSION}`);
  await waitFor(() => expect(screen.getByText("运行中脚本")).toBeInTheDocument());
  expect(screen.queryByText("快速操作")).not.toBeInTheDocument();
  expect(within(navigation).getByRole("button", { name: "工作台" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(within(navigation).getByRole("button", { name: "提醒" })).toBeInTheDocument();
  expect(within(navigation).getByRole("button", { name: "翻译" })).toBeInTheDocument();
  expect(
    screen.getByPlaceholderText(
      "搜索功能或输入命令，例如：翻译、Ping、下载、脚本任务...",
    ),
  ).toBeInTheDocument();
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
    screen.queryByRole("button", { name: "返回工作台" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByPlaceholderText(
      "搜索功能或输入命令，例如：翻译、Ping、下载、脚本任务...",
    ),
  ).not.toBeInTheDocument();
});
