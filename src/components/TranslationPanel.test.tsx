import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TranslationPanel } from "./TranslationPanel";

vi.mock("../lib/api", () => ({
  translateText: vi.fn(async () => ({
    translatedText: "你好，世界",
  })),
}));

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

it("uses the default target language without showing a language selector", () => {
  const { container } = render(
    <TranslationPanel
      onOpenSettings={() => {}}
    />,
  );

  expect(screen.queryByLabelText("目标语言")).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(container.querySelector(".translation-stack")).toBeInTheDocument();
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
  const api = await import("../lib/api");
  expect(api.translateText).toHaveBeenCalledWith({
    text: "Hello world",
  });
});
