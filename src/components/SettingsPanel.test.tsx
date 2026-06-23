import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
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
  })),
  updateSettings: vi.fn(async (settings) => settings),
  updateAiSettings: vi.fn(async (settings) => settings),
  testAiConnection: vi.fn(async () => undefined),
  testNotification: vi.fn(async () => undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

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

it("loads and saves ai translation settings", async () => {
  const user = userEvent.setup();
  render(<SettingsPanel />);

  const modelInput = await screen.findByLabelText("模型名称");
  await user.clear(modelInput);
  await user.type(modelInput, "deepseek-r1");
  await user.click(screen.getByRole("button", { name: "保存 AI 设置" }));

  const api = await import("../lib/api");
  expect(api.updateAiSettings).toHaveBeenCalledWith({
    baseUrl: "http://localhost:11434/v1",
    model: "deepseek-r1",
    apiKey: "",
  });
});

it("can test ai connection", async () => {
  const user = userEvent.setup();
  render(<SettingsPanel />);

  await user.click(await screen.findByRole("button", { name: "测试 AI 连接" }));

  const api = await import("../lib/api");
  expect(api.testAiConnection).toHaveBeenCalled();
});

it("shows the default ai connection status and can reveal api key", async () => {
  const user = userEvent.setup();
  render(<SettingsPanel />);

  expect(await screen.findByTestId("ai-test-message")).toHaveTextContent("未测试");
  const apiKeyInput = screen.getByLabelText("API Key");
  expect(apiKeyInput).toHaveAttribute("type", "password");

  await user.click(screen.getByRole("button", { name: "显示" }));

  expect(apiKeyInput).toHaveAttribute("type", "text");
  expect(screen.getByRole("button", { name: "隐藏" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "测试通知" })).not.toBeInTheDocument();
});

it("saves current ai settings before testing and shows result in the action row", async () => {
  const user = userEvent.setup();
  render(<SettingsPanel />);

  const baseUrlInput = await screen.findByLabelText("API 地址");
  await user.clear(baseUrlInput);
  await user.type(baseUrlInput, "https://api.deepseek.com");
  await user.click(screen.getByRole("button", { name: "测试 AI 连接" }));

  const api = await import("../lib/api");
  expect(api.updateAiSettings).toHaveBeenCalledWith({
    baseUrl: "https://api.deepseek.com",
    model: "qwen2.5:7b",
    apiKey: "",
  });
  expect(vi.mocked(api.updateAiSettings)).toHaveBeenCalledBefore(
    vi.mocked(api.testAiConnection),
  );
  expect(screen.getByTestId("ai-test-message")).toHaveTextContent("AI 连接正常。");
  expect(screen.getByTestId("ai-test-actions")).toContainElement(
    screen.getByTestId("ai-test-message"),
  );
});

it("shows ai test failures in the action row instead of the page alert", async () => {
  const api = await import("../lib/api");
  vi.mocked(api.testAiConnection).mockRejectedValueOnce({
    message: "AI provider request failed",
  });

  const user = userEvent.setup();
  render(<SettingsPanel />);

  await user.click(await screen.findByRole("button", { name: "测试 AI 连接" }));

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByTestId("ai-test-message")).toHaveTextContent(
    "AI provider request failed",
  );
  expect(screen.getByTestId("ai-test-message")).toHaveClass("error");
  expect(screen.getByTestId("ai-test-actions")).toContainElement(
    screen.getByTestId("ai-test-message"),
  );
});
