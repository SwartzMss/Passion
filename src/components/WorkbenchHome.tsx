import { useMemo, useState } from "react";

interface Props {
  pendingReminderCount: number;
  enabledScriptTaskCount: number;
  runningScriptTaskCount: number;
  totalScriptTaskCount: number;
}

export function WorkbenchHome({
  pendingReminderCount,
  enabledScriptTaskCount,
  runningScriptTaskCount,
  totalScriptTaskCount,
}: Props) {
  const [query, setQuery] = useState("");
  const summaries = useMemo(
    () => [
      {
        label: "待提醒",
        value: String(pendingReminderCount),
        description: "当前启用且等待触发的提醒",
        keywords: "提醒 待提醒 通知 日程",
      },
      {
        label: "启用脚本",
        value: `${enabledScriptTaskCount} / ${totalScriptTaskCount}`,
        description: "后台定期任务启用情况",
        keywords: "脚本 任务 自动化 启用",
      },
      {
        label: "运行中任务",
        value: String(runningScriptTaskCount),
        description: "已启动但尚未结束的脚本",
        keywords: "运行中 脚本 任务 后台",
      },
    ],
    [enabledScriptTaskCount, pendingReminderCount, runningScriptTaskCount, totalScriptTaskCount],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSummaries = normalizedQuery
    ? summaries.filter((item) =>
        `${item.label} ${item.value} ${item.description} ${item.keywords}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : summaries;

  return (
    <section className="workbench">
      <div className="workbench-searchbar">
        <label className="feature-search">
          <span className="sr-only">搜索状态</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索状态，例如：提醒、脚本、运行"
          />
        </label>
      </div>

      {visibleSummaries.length > 0 ? (
        <div className="workbench-summary" aria-label="工作台摘要">
          {visibleSummaries.map((item) => (
            <article className="summary-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">没有找到相关状态</div>
      )}
    </section>
  );
}
