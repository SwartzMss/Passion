import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DownloadPanel } from "./DownloadPanel";

let resolveDownload: ((value: {
  url: string;
  fileName: string;
  savedPath: string;
  bytes: number;
  elapsedMs: number;
}) => void) | null = null;

vi.mock("../lib/api", () => ({
  downloadFile: vi.fn(
    () =>
      new Promise((resolve) => {
        resolveDownload = resolve;
      }),
  ),
}));

it("renders the desktop download workspace", () => {
  render(<DownloadPanel />);

  expect(screen.getByRole("heading", { name: "下载工具" })).toBeInTheDocument();
  expect(screen.getByText("输入 HTTP/HTTPS 地址，文件会保存到系统下载目录。")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "新建下载任务" })).toBeInTheDocument();
  expect(screen.getByLabelText("下载地址")).toHaveAttribute(
    "placeholder",
    "请输入 HTTP/HTTPS 地址，例如：https://example.com/file.zip",
  );
  expect(screen.getByLabelText("文件名（可选）")).toBeInTheDocument();
  expect(screen.getByText("保存位置")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "更改目录" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "全部 0" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载中 0" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已完成 0" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "失败 0" })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("搜索文件名或地址")).toBeInTheDocument();
  expect(screen.getByText("选择一个下载任务")).toBeInTheDocument();
});

it("rejects empty download url", async () => {
  const user = userEvent.setup();
  render(<DownloadPanel />);

  await user.click(screen.getByRole("button", { name: "开始下载" }));

  expect(screen.getByText("请输入 HTTP/HTTPS 下载地址。")).toBeInTheDocument();
});

it("downloads a file and shows saved path", async () => {
  const user = userEvent.setup();
  render(<DownloadPanel />);

  await user.type(screen.getByLabelText("下载地址"), "https://example.com/file.zip");
  await user.click(screen.getByRole("button", { name: "开始下载" }));

  expect(screen.getByRole("button", { name: "下载中 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "全部 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "https://example.com/file.zip" })).toBeInTheDocument();

  resolveDownload?.({
    url: "https://example.com/file.zip",
    fileName: "file.zip",
    savedPath: "C:\\Users\\swart\\Downloads\\file.zip",
    bytes: 1024,
    elapsedMs: 50,
  });

  expect(await screen.findByRole("button", { name: "file.zip" })).toBeInTheDocument();
  expect(screen.getByText("C:\\Users\\swart\\Downloads\\file.zip")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已完成 1" })).toBeInTheDocument();
  expect(screen.getByText("100%")).toBeInTheDocument();
  const api = await import("../lib/api");
  expect(api.downloadFile).toHaveBeenCalledWith({
    url: "https://example.com/file.zip",
    fileName: "",
  });
});
