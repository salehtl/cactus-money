import { Modal } from "./Modal.tsx";
import { Button } from "./Button.tsx";

export interface RecurringDeleteModalProps {
  open: boolean;
  /** Total number of transactions being deleted (1 for single, N for bulk) */
  totalCount: number;
  /** Number of recurring transactions in the selection */
  recurringCount: number;
  onCancel: () => void;
  onJustThis: () => void;
  onAllFuture: () => void;
}

export function RecurringDeleteModal({
  open,
  totalCount,
  recurringCount,
  onCancel,
  onJustThis,
  onAllFuture,
}: RecurringDeleteModalProps) {
  const isBulk = totalCount > 1;
  const nonRecurringCount = totalCount - recurringCount;

  return (
    <Modal open={open} onClose={onCancel} title={isBulk ? `Delete ${totalCount} transactions?` : "Delete recurring transaction?"}>
      {isBulk ? (
        <p className="text-sm text-text-muted mb-5">
          {nonRecurringCount > 0 ? (
            <>{nonRecurringCount} one-time transaction{nonRecurringCount !== 1 ? "s" : ""} will be deleted. </>
          ) : null}
          {recurringCount} {recurringCount === 1 ? "is" : "are"} part of a recurring series — what should happen to future occurrences?
        </p>
      ) : (
        <p className="text-sm text-text-muted mb-5">
          This transaction is part of a recurring series. What would you like to delete?
        </p>
      )}
      <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" size="sm" onClick={onJustThis}>
          {isBulk ? "Delete, keep future" : "Just this one"}
        </Button>
        <Button variant="danger" size="sm" onClick={onAllFuture}>
          {isBulk ? "Delete, stop recurring" : "This and all future"}
        </Button>
      </div>
    </Modal>
  );
}
