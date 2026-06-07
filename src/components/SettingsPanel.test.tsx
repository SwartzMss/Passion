import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("../lib/api", () => ({
  getSettings: vi.fn(async () => ({
    launchOnStartup: false,
    minimizeToTray: true,
    notificationEnabled: true,
  })),
  updateSettings: vi.fn(async (settings) => settings),
  testNotification: vi.fn(async () => undefined),
}));

it("loads and updates settings", async () => {
  const user = userEvent.setup();
  render(<SettingsPanel />);

  await waitFor(() =>
    expect(screen.getByLabelText("最小化到托盘")).toBeChecked(),
  );
  await user.click(screen.getByLabelText("开机自启动"));

  const api = await import("../lib/api");
  expect(api.updateSettings).toHaveBeenCalledWith({
    launchOnStartup: true,
    minimizeToTray: true,
    notificationEnabled: true,
  });
});

it("can send a test notification", async () => {
  const user = userEvent.setup();
  render(<SettingsPanel />);

  await user.click(
    await screen.findByRole("button", { name: "测试通知" }),
  );

  const api = await import("../lib/api");
  expect(api.testNotification).toHaveBeenCalled();
});
