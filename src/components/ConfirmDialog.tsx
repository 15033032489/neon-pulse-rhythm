interface ConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={onCancel}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="abandon-title"
        aria-describedby="abandon-description"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="overlay-index">// ABANDON SESSION</span>
        <h2 id="abandon-title">放弃本局？</h2>
        <p id="abandon-description">
          本局不会保存，也不会把剩余音符补记为 Miss。
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="dialog-cancel"
            onClick={onCancel}
            autoFocus
          >
            取消
          </button>
          <button type="button" className="dialog-danger" onClick={onConfirm}>
            确认放弃
          </button>
        </div>
      </section>
    </div>
  );
}
