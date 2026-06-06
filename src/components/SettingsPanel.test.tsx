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
    expect(screen.getByLabelText("Minimize to tray")).toBeChecked(),
  );
  await user.click(screen.getByLabelText("Launch on startup"));

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
    await screen.findByRole("button", { name: "Test notification" }),
  );

  const api = await import("../lib/api");
  expect(api.testNotification).toHaveBeenCalled();
});
