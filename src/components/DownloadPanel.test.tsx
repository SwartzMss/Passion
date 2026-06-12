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
  const api = await import("../lib/api");
  expect(api.downloadFile).toHaveBeenCalledWith({
    url: "https://example.com/file.zip",
    fileName: "",
  });
});
