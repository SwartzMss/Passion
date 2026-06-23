import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { UtilitiesPanel } from "./UtilitiesPanel";

it("shows one utility tab at a time", async () => {
  const user = userEvent.setup();
  render(<UtilitiesPanel />);

  expect(screen.getByRole("tab", { name: "Base64" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByLabelText("Base64 输入")).toBeInTheDocument();
  expect(screen.queryByLabelText("Hex 输入")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("时间戳输入")).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Hex" }));

  expect(screen.getByRole("tab", { name: "Hex" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByLabelText("Hex 输入")).toBeInTheDocument();
  expect(screen.queryByLabelText("Base64 输入")).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "时间戳" }));

  expect(screen.getByRole("tab", { name: "时间戳" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByLabelText("时间戳输入")).toBeInTheDocument();
  expect(screen.queryByLabelText("Hex 输入")).not.toBeInTheDocument();
});

it("encodes and decodes base64 text with unicode content", async () => {
  const user = userEvent.setup();
  render(<UtilitiesPanel />);

  await user.type(screen.getByLabelText("Base64 输入"), "你好 Passion");
  await user.click(screen.getByRole("button", { name: "编码" }));

  const result = screen.getByLabelText("Base64 结果");
  expect(result).toHaveValue("5L2g5aW9IFBhc3Npb24=");

  await user.clear(screen.getByLabelText("Base64 输入"));
  await user.type(screen.getByLabelText("Base64 输入"), "5L2g5aW9IFBhc3Npb24=");
  await user.click(screen.getByRole("button", { name: "解码" }));

  expect(result).toHaveValue("你好 Passion");
});

it("converts text to hex and validates invalid hex input", async () => {
  const user = userEvent.setup();
  render(<UtilitiesPanel />);

  await user.click(screen.getByRole("tab", { name: "Hex" }));
  await user.type(screen.getByLabelText("Hex 输入"), "Hi");
  await user.click(screen.getByRole("button", { name: "编码" }));

  expect(screen.getByLabelText("Hex 结果")).toHaveValue("48 69");

  await user.clear(screen.getByLabelText("Hex 输入"));
  await user.type(screen.getByLabelText("Hex 输入"), "48 69");
  await user.click(screen.getByRole("button", { name: "解码" }));

  expect(screen.getByLabelText("Hex 结果")).toHaveValue("Hi");

  await user.clear(screen.getByLabelText("Hex 输入"));
  await user.type(screen.getByLabelText("Hex 输入"), "GG");
  await user.click(screen.getByRole("button", { name: "解码" }));

  expect(screen.getByText("Hex 内容格式不正确。")).toBeInTheDocument();
});

it("converts second and millisecond timestamps", async () => {
  const user = userEvent.setup();
  render(<UtilitiesPanel />);

  await user.click(screen.getByRole("tab", { name: "时间戳" }));
  await user.clear(screen.getByLabelText("时间戳输入"));
  await user.type(screen.getByLabelText("时间戳输入"), "1700000000");
  await user.click(screen.getByRole("button", { name: "转换时间戳" }));

  expect(screen.getByLabelText("ISO 时间")).toHaveValue("2023-11-14T22:13:20.000Z");
  expect(screen.getByLabelText("秒级时间戳")).toHaveValue("1700000000");
  expect(screen.getByLabelText("毫秒级时间戳")).toHaveValue("1700000000000");

  await user.clear(screen.getByLabelText("时间戳输入"));
  await user.type(screen.getByLabelText("时间戳输入"), "1700000000000");
  await user.click(screen.getByRole("button", { name: "转换时间戳" }));

  expect(screen.getByLabelText("ISO 时间")).toHaveValue("2023-11-14T22:13:20.000Z");
});

it("rejects oversized utility input before doing synchronous conversion", async () => {
  const user = userEvent.setup();
  render(<UtilitiesPanel />);

  fireEvent.change(screen.getByLabelText("Base64 输入"), {
    target: { value: "a".repeat(1_000_001) },
  });
  await user.click(screen.getByRole("button", { name: "编码" }));

  expect(screen.getByText("输入内容过大，请控制在 1 MB 以内。")).toBeInTheDocument();
  expect(screen.getByLabelText("Base64 结果")).toHaveValue("");
});
