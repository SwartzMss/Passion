import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TranslationPanel } from "./TranslationPanel";
import { translateText } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  translateText: vi.fn(async () => ({
    translatedText: "你好，世界",
  })),
}));

beforeEach(() => {
  vi.mocked(translateText).mockClear();
});

it.each(["原文", "源语言", "目标语言", "交换语言"])("ignores an in-flight result after changing %s", async (field) => {
  let finish!: (value: { translatedText: string }) => void;
  vi.mocked(translateText).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<TranslationPanel onOpenSettings={() => {}} />);
  fireEvent.change(screen.getByLabelText("原文"), { target: { value: "hello" } });
  fireEvent.click(screen.getByRole("button", { name: "翻译" }));
  if (field === "交换语言") fireEvent.click(screen.getByRole("button", { name: field }));
  else fireEvent.change(screen.getByLabelText(field), { target: { value: field === "原文" ? "new text" : "ko" } });
  await act(async () => finish({ translatedText: "old translation" }));
  expect(screen.getByLabelText("译文")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "翻译" }));
  expect(await screen.findByDisplayValue("你好，世界")).toBeInTheDocument();
});

it("clears a completed translation when its target language changes", async () => {
  render(<TranslationPanel onOpenSettings={() => {}} />);
  fireEvent.change(screen.getByLabelText("原文"), { target: { value: "hello" } });
  fireEvent.click(screen.getByRole("button", { name: "翻译" }));
  await screen.findByDisplayValue("你好，世界");
  fireEvent.change(screen.getByLabelText("目标语言"), { target: { value: "ja" } });
  expect(screen.getByLabelText("译文")).toHaveValue("");
});

it("rejects empty source text", async () => {
  const user = userEvent.setup();
  render(
    <TranslationPanel
      onOpenSettings={() => {}}
    />,
  );

  await user.click(screen.getByRole("button", { name: "翻译" }));

  expect(screen.getByText("请输入要翻译的内容。")).toBeInTheDocument();
});

it("renders the desktop translation workspace", () => {
  const onOpenSettings = vi.fn();
  render(
    <TranslationPanel
      onOpenSettings={onOpenSettings}
    />,
  );

  expect(screen.getByRole("heading", { name: "翻译" })).toBeInTheDocument();
  expect(screen.getByText("通过 OpenAI 兼容接口调用本地或云端模型。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "AI 设置" })).toBeInTheDocument();
  expect(screen.getByLabelText("源语言")).toHaveValue("auto");
  expect(screen.getByLabelText("目标语言")).toHaveValue("zh-CN");
  expect(screen.getByRole("button", { name: "交换语言" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "粘贴" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "清空" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "复制译文" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "重新翻译" })).toBeDisabled();
});

it("translates text and displays the result", async () => {
  const user = userEvent.setup();
  render(
    <TranslationPanel
      onOpenSettings={() => {}}
    />,
  );

  await user.type(screen.getByLabelText("原文"), "Hello world");
  await user.click(screen.getByRole("button", { name: "翻译" }));

  expect(await screen.findByText("你好，世界")).toBeInTheDocument();
  expect(translateText).toHaveBeenCalledWith({
    text: "Hello world",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
  });
});

it("submits selected languages including Japanese and Korean", async () => {
  const user = userEvent.setup();
  render(<TranslationPanel onOpenSettings={() => {}} />);
  await user.selectOptions(screen.getByLabelText("源语言"), "ja");
  await user.selectOptions(screen.getByLabelText("目标语言"), "ko");
  await user.type(screen.getByLabelText("原文"), "こんにちは");
  await user.click(screen.getByRole("button", { name: "翻译" }));
  expect(translateText).toHaveBeenCalledWith({ text: "こんにちは", sourceLanguage: "ja", targetLanguage: "ko" });
});

it("blocks repeated keyboard submits and ignores a response after clearing", async () => {
  let finish!: (value: { translatedText: string }) => void;
  vi.mocked(translateText).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const user = userEvent.setup();
  render(<TranslationPanel onOpenSettings={() => {}} />);
  await user.type(screen.getByLabelText("原文"), "hello");
  await user.keyboard("{Control>}{Enter}{Enter}{/Control}");
  expect(translateText).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "清空" }));
  await act(async () => finish({ translatedText: "late result" }));
  expect(screen.getByLabelText("译文")).toHaveValue("");
  expect(screen.getByRole("button", { name: "翻译" })).toBeEnabled();
});

it("clears source and translated text", async () => {
  const user = userEvent.setup();
  render(
    <TranslationPanel
      onOpenSettings={() => {}}
    />,
  );

  await user.type(screen.getByLabelText("原文"), "Hello world");
  await user.click(screen.getByRole("button", { name: "翻译" }));
  expect(await screen.findByText("你好，世界")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "清空" }));

  expect(screen.getByLabelText("原文")).toHaveValue("");
  expect(within(screen.getByLabelText("译文结果")).queryByText("你好，世界")).not.toBeInTheDocument();
});
