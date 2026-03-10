import { Modal } from "./Modal.tsx";
import { Button } from "./Button.tsx";

export interface RecurringScopeModalProps {
  open: boolean;
  fieldLabel: string;
  fromValue: string;
  toValue: string;
  onJustThis: () => void;
  onAllFuture: () => void;
  onCancel: () => void;
}

export function RecurringScopeModal({
  open,
  fieldLabel,
  fromValue,
  toValue,
  onJustThis,
  onAllFuture,
  onCancel,
}: RecurringScopeModalProps) {
  return (
    <Modal open={open} onClose={onCancel} title="Update recurring transaction?">
      <p className="text-sm text-text-muted mb-5">
        You changed the <span className="font-medium text-text">{fieldLabel}</span> from{" "}
        <span className="font-medium text-text">{fromValue}</span> to{" "}
        <span className="font-medium text-text">{toValue}</span>.
      </p>
      <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" size="sm" onClick={onJustThis}>
          Just this one
        </Button>
        <Button variant="primary" size="sm" onClick={onAllFuture}>
          Update all future
        </Button>
      </div>
    </Modal>
  );
}
