export type TransactionStatus = "planned" | "confirmed" | "review";

export function StatusPill({
  status,
  onClick,
  disabled,
}: {
  status: TransactionStatus;
  onClick: () => void;
  disabled?: boolean;
}) {
  const config = {
    planned: {
      className: "border border-dashed border-border-dark text-text-light hover:border-accent hover:text-accent",
      dotClass: "bg-text-light/50",
      label: "Plan",
      title: "Mark as confirmed",
    },
    confirmed: {
      className: "bg-success/10 text-success hover:bg-success/20",
      dotClass: "bg-success",
      label: "Conf",
      title: "Mark as planned",
    },
    review: {
      className: "bg-warning/10 text-warning border border-dashed border-warning/30 hover:bg-warning/20",
      dotClass: "bg-warning",
      label: "Review",
      title: "Needs amount review — click to confirm",
    },
  }[status];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer leading-tight ${config.className}`}
      title={config.title}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      {config.label}
    </button>
  );
}
