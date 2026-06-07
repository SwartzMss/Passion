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
  getAiSettings: vi.fn(async () => ({
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    apiKey: "",
    defaultTargetLanguage: "中文",
  })),
  updateSettings: vi.fn(async (settings) => settings),
  updateAiSettings: vi.fn(async (settings) => settings),
  testAiConnection: vi.fn(async () => undefined),
  testNotification: vi.fn(async () => undefined),
}));

it("loads and updates settings", async () => {
  const user = userEvent.setup();
  render(<SettingsPanel onBack={() => {}} />);

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
  render(<SettingsPanel onBack={() => {}} />);

  await user.click(
    await screen.findByRole("button", { name: "测试通知" }),
  );

  const api = await import("../lib/api");
  expect(api.testNotification).toHaveBeenCalled();
});

it("loads and saves ai translation settings", async () => {
  const user = userEvent.setup();
  render(<SettingsPanel onBack={() => {}} />);

  const modelInput = await screen.findByLabelText("模型名称");
  await user.clear(modelInput);
  await user.type(modelInput, "deepseek-r1");
  await user.click(screen.getByRole("button", { name: "保存 AI 设置" }));

  const api = await import("../lib/api");
  expect(api.updateAiSettings).toHaveBeenCalledWith({
    baseUrl: "http://localhost:11434/v1",
    model: "deepseek-r1",
    apiKey: "",
    defaultTargetLanguage: "中文",
  });
});

it("can test ai connection", async () => {
  const user = userEvent.setup();
  render(<SettingsPanel onBack={() => {}} />);

  await user.click(await screen.findByRole("button", { name: "测试 AI 连接" }));

  const api = await import("../lib/api");
  expect(api.testAiConnection).toHaveBeenCalled();
});

it("can return to the workbench", async () => {
  const user = userEvent.setup();
  const onBack = vi.fn();
  render(<SettingsPanel onBack={onBack} />);

  await user.click(await screen.findByRole("button", { name: "返回工作台" }));

  expect(onBack).toHaveBeenCalled();
});
