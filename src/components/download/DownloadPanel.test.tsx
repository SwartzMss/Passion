import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DownloadPanel } from "./DownloadPanel";
import type { DownloadProgressEvent } from "../../types";

let resolveDownload: ((value: {
  url: string;
  fileName: string;
  savedPath: string;
  bytes: number;
  elapsedMs: number;
}) => void) | null = null;

vi.mock("../../lib/api", () => ({
  getDefaultDownloadDir: vi.fn(async () => "C:\\Users\\tester\\Downloads"),
  pauseDownload: vi.fn(async () => undefined),
  cancelDownload: vi.fn(async () => undefined),
  downloadFile: vi.fn(
    () =>
      new Promise((resolve) => {
        resolveDownload = resolve;
      }),
  ),
}));

let downloadProgressHandler: ((event: DownloadProgressEvent) => void) | null = null;

vi.mock("../../lib/events", () => ({
  onDownloadProgress: vi.fn(async (handler: (event: DownloadProgressEvent) => void) => {
    downloadProgressHandler = handler;
    return vi.fn();
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => "D:\\Downloads"),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(async () => undefined),
}));

function emitDownloadProgress(event: DownloadProgressEvent) {
  act(() => {
    downloadProgressHandler?.(event);
  });
}

it("renders the desktop download workspace", () => {
  render(<DownloadPanel />);

  expect(screen.getByRole("heading", { name: "下载工具" })).toBeInTheDocument();
  expect(screen.getByText("支持 HTTP/HTTPS 地址、本地文件路径和局域网共享文件。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "新建下载" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "新建下载任务" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /全部/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "当前任务 0" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已完成任务 0" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "失败任务 0" })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("搜索文件名或地址")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "下载任务列表" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "文件名" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "进度" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "速度" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "大小" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "剩余时间" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "状态" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
  expect(screen.getByText("当前没有正在下载的任务。")).toBeInTheDocument();
  expect(screen.getByText("总任务: 0 | 活动: 0 | 已完成: 0 | 失败: 0")).toBeInTheDocument();
});

it("rejects empty download url", async () => {
  const user = userEvent.setup();
  render(<DownloadPanel />);

  await user.click(screen.getByRole("button", { name: "新建下载" }));
  await user.click(screen.getByRole("button", { name: "开始下载" }));

  expect(screen.getByText("请输入下载地址或本地文件路径。")).toBeInTheDocument();
});

it("downloads a file and shows saved path", async () => {
  const user = userEvent.setup();
  render(<DownloadPanel />);

  await user.click(screen.getByRole("button", { name: "新建下载" }));
  expect(screen.getByRole("dialog", { name: "新建下载任务" })).toBeInTheDocument();
  expect(await screen.findByText("C:\\Users\\tester\\Downloads")).toBeInTheDocument();
  expect(screen.getByLabelText("下载地址或本地文件路径")).toHaveAttribute(
    "placeholder",
    String.raw`例如：https://example.com/file.zip 或 \\\\server\\share\\file.yaml`,
  );
  expect(screen.queryByLabelText("文件名（可选）")).not.toBeInTheDocument();
  expect(screen.getByText("保存位置")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "选择目录" }));
  expect(await screen.findByText("D:\\Downloads")).toBeInTheDocument();
  await user.type(screen.getByLabelText("下载地址或本地文件路径"), "https://example.com/file.zip");
  await user.click(screen.getByRole("button", { name: "开始下载" }));

  expect(screen.queryByRole("dialog", { name: "新建下载任务" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "当前任务 1" })).toBeInTheDocument();
  expect(screen.getByText("file.zip")).toBeInTheDocument();
  expect(screen.getAllByText("等待开始").length).toBeGreaterThan(0);

  const api = await import("../../lib/api");
  const request = vi.mocked(api.downloadFile).mock.calls[0]?.[0];
  expect(request).toEqual({
    taskId: expect.any(String),
    url: "https://example.com/file.zip",
    saveDir: "D:\\Downloads",
  });

  emitDownloadProgress({
    taskId: request.taskId!,
    url: "https://example.com/file.zip",
    fileName: "file.zip",
    savedPath: "D:\\Downloads\\file.zip",
    totalBytes: 2048,
    downloadedBytes: 1024,
    elapsedMs: 1000,
    bytesPerSecond: 1024,
    status: "running",
  });

  expect(await screen.findByText("50%")).toBeInTheDocument();
  expect(screen.getAllByText("1.0 KB/s").length).toBeGreaterThan(0);
  expect(screen.getByText("2.0 KB")).toBeInTheDocument();

  resolveDownload?.({
    url: "https://example.com/file.zip",
    fileName: "file.zip",
    savedPath: "C:\\Users\\tester\\Downloads\\file.zip",
    bytes: 1024,
    elapsedMs: 50,
  });

  expect(await screen.findByRole("button", { name: "已完成任务 1" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "已完成任务 1" }));
  expect(screen.getByText("file.zip")).toBeInTheDocument();
  expect(screen.getByText("C:\\Users\\tester\\Downloads\\file.zip")).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "进度" })).not.toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "速度" })).not.toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "剩余时间" })).not.toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "完成时间" })).toBeInTheDocument();
  expect(screen.getByText("总任务: 1 | 活动: 0 | 已完成: 1 | 失败: 0")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "打开文件夹" }));
  const opener = await import("@tauri-apps/plugin-opener");
  expect(opener.revealItemInDir).toHaveBeenCalledWith("C:\\Users\\tester\\Downloads\\file.zip");
});

it("formats large running downloads as GB and supports pausing", async () => {
  const user = userEvent.setup();
  render(<DownloadPanel />);

  await user.click(screen.getByRole("button", { name: "新建下载" }));
  await user.type(screen.getByLabelText("下载地址或本地文件路径"), "https://example.com/movie.mkv");
  await user.click(screen.getByRole("button", { name: "开始下载" }));

  const api = await import("../../lib/api");
  const calls = vi.mocked(api.downloadFile).mock.calls;
  const request = calls[calls.length - 1]?.[0];
  emitDownloadProgress({
    taskId: request!.taskId!,
    url: "https://example.com/movie.mkv",
    fileName: "movie.mkv",
    savedPath: "D:\\Downloads\\movie.mkv",
    totalBytes: 25_000_000_000,
    downloadedBytes: 12_500_000_000,
    elapsedMs: 5000,
    bytesPerSecond: 2_500_000,
    status: "running",
  });

  expect(await screen.findByText("23.3 GB")).toBeInTheDocument();
  expect(screen.getByText("2.4 MB/s")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "暂停" }));
  expect(api.pauseDownload).toHaveBeenCalledWith(request!.taskId);
  expect(screen.getByText("已暂停")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "继续" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
});

it("marks a canceled running download as failed with a user cancel reason", async () => {
  const user = userEvent.setup();
  render(<DownloadPanel />);

  await user.click(screen.getByRole("button", { name: "新建下载" }));
  await user.type(screen.getByLabelText("下载地址或本地文件路径"), "https://example.com/movie.mkv");
  await user.click(screen.getByRole("button", { name: "开始下载" }));

  const api = await import("../../lib/api");
  const calls = vi.mocked(api.downloadFile).mock.calls;
  const request = calls[calls.length - 1]?.[0];
  await user.click(await screen.findByRole("button", { name: "取消" }));

  expect(api.cancelDownload).toHaveBeenCalledWith(request!.taskId);
  emitDownloadProgress({
    taskId: request!.taskId!,
    url: "https://example.com/movie.mkv",
    fileName: "movie.mkv",
    savedPath: "D:\\Downloads\\movie.mkv",
    totalBytes: 2048,
    downloadedBytes: 1024,
    elapsedMs: 1000,
    bytesPerSecond: 1024,
    status: "running",
  });

  expect(screen.getByRole("button", { name: "当前任务 0" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "失败任务 1" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "失败任务 1" }));
  expect(screen.getByText("用户取消")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
});

it("keeps a paused download in current tasks when the backend command rejects with pause", async () => {
  const user = userEvent.setup();
  render(<DownloadPanel />);

  await user.click(screen.getByRole("button", { name: "新建下载" }));
  await user.type(screen.getByLabelText("下载地址或本地文件路径"), "https://example.com/movie.mkv");
  await user.click(screen.getByRole("button", { name: "开始下载" }));

  const api = await import("../../lib/api");
  const calls = vi.mocked(api.downloadFile).mock.calls;
  const request = calls[calls.length - 1]?.[0];
  emitDownloadProgress({
    taskId: request!.taskId!,
    url: "https://example.com/movie.mkv",
    fileName: "movie.mkv",
    savedPath: "D:\\Downloads\\movie.mkv",
    totalBytes: 2048,
    downloadedBytes: 1024,
    elapsedMs: 1000,
    bytesPerSecond: 1024,
    status: "paused",
  });

  expect(await screen.findByText("已暂停")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "当前任务 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "失败任务 0" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "继续" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
});

it("marks a canceled paused download as failed with a user cancel reason", async () => {
  const user = userEvent.setup();
  render(<DownloadPanel />);

  await user.click(screen.getByRole("button", { name: "新建下载" }));
  await user.type(screen.getByLabelText("下载地址或本地文件路径"), "https://example.com/movie.mkv");
  await user.click(screen.getByRole("button", { name: "开始下载" }));

  const api = await import("../../lib/api");
  const calls = vi.mocked(api.downloadFile).mock.calls;
  const request = calls[calls.length - 1]?.[0];
  emitDownloadProgress({
    taskId: request!.taskId!,
    url: "https://example.com/movie.mkv",
    fileName: "movie.mkv",
    savedPath: "D:\\Downloads\\movie.mkv",
    totalBytes: 2048,
    downloadedBytes: 1024,
    elapsedMs: 1000,
    bytesPerSecond: 1024,
    status: "paused",
  });

  await user.click(await screen.findByRole("button", { name: "取消" }));

  expect(api.cancelDownload).toHaveBeenCalledWith(request!.taskId);
  expect(screen.getByRole("button", { name: "当前任务 0" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "失败任务 1" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "失败任务 1" }));
  expect(screen.getByText("movie.mkv")).toBeInTheDocument();
  expect(screen.getByText("用户取消")).toBeInTheDocument();
});

it("infers the display name from a local or shared path before the backend returns", async () => {
  const user = userEvent.setup();
  render(<DownloadPanel />);

  await user.click(screen.getByRole("button", { name: "新建下载" }));
  await user.type(
    screen.getByLabelText("下载地址或本地文件路径"),
    String.raw`\\192.0.2.10\video\movie.mkv`,
  );
  await user.click(screen.getByRole("button", { name: "开始下载" }));

  expect(screen.getByText("movie.mkv")).toBeInTheDocument();
  expect(screen.queryByText(String.raw`\\192.0.2.10\video\movie.mkv`)).not.toBeInTheDocument();
  expect(document.querySelector(".download-file-icon")).not.toBeInTheDocument();
});
