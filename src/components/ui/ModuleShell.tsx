type ModuleShellProps = {
  title: string;
  description: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
};

export function ModuleShell({ title, description, actions, children }: ModuleShellProps) {
  return (
    <section className="space-y-6">
      <div className="rounded-[28px] border border-border/60 bg-surface/80 p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted">Module</p>
            <h1 className="font-display text-3xl text-text">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      </div>
      {children ?? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {['Workspace', 'Analytics', 'Automation'].map((label) => (
            <div
              key={label}
              className="rounded-2xl border border-border/60 bg-bg/70 p-4 text-sm text-muted"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-muted">
                {label}
              </p>
              <p className="mt-2 text-sm text-text">
                Configure {label.toLowerCase()} workflows here.
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
