interface Props {
  pendingReminderCount: number;
  onOpenReminders: () => void;
  onAddReminder: () => void;
  onOpenTranslation: () => void;
  onOpenSettings: () => void;
}

export function WorkbenchHome({
  pendingReminderCount,
  onOpenReminders,
  onAddReminder,
  onOpenTranslation,
  onOpenSettings,
}: Props) {
  return (
    <section className="workbench">
      <div className="workbench-hero">
        <div>
          <h2>工作台</h2>
          <p className="muted">管理提醒，也可以用本地或兼容模型进行翻译。</p>
        </div>
        <button onClick={onOpenSettings}>设置</button>
      </div>

      <div className="feature-grid">
        <article className="feature-card">
          <div>
            <h3>提醒</h3>
            <p className="muted">{pendingReminderCount} 个待提醒</p>
          </div>
          <div className="card-actions">
            <button onClick={onOpenReminders}>查看提醒</button>
            <button onClick={onAddReminder}>新增提醒</button>
          </div>
        </article>

        <article className="feature-card">
          <div>
            <h3>翻译</h3>
            <p className="muted">支持 OpenAI 兼容接口和本地部署模型。</p>
          </div>
          <div className="card-actions">
            <button onClick={onOpenTranslation}>开始翻译</button>
          </div>
        </article>
      </div>
    </section>
  );
}
