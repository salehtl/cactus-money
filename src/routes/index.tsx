import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { PageHeader } from "../components/layout/PageHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { ConfirmDialog } from "../components/ui/ConfirmDialog.tsx";
import { RecurringScopeModal } from "../components/ui/RecurringScopeModal.tsx";
import { RecurringDeleteModal } from "../components/ui/RecurringDeleteModal.tsx";
import { useToast } from "../components/ui/Toast.tsx";
import { CashflowToolbar } from "../components/cashflow/CashflowToolbar.tsx";
import { SingleMonthView } from "../components/cashflow/SingleMonthView.tsx";
import { AddRowDialog } from "../components/cashflow/AddRowDialog.tsx";
import { PdfImportButton } from "../components/pdf-import/PdfImportButton.tsx";
import { PdfImportModal } from "../components/pdf-import/PdfImportModal.tsx";
import { useCashflow } from "../hooks/useCashflow.ts";
import { useCategories } from "../hooks/useCategories.ts";
import { useDb } from "../context/DbContext.tsx";
import { getSetting, setSetting } from "../db/queries/settings.ts";
import { getCurrentMonth, formatCurrency, stepMonth } from "../lib/format.ts";
import type { GroupBy } from "../lib/cashflow.ts";

export const Route = createFileRoute("/")({
  component: CashflowPage,
});

// Pending recurring edit state
interface PendingRecurringEdit {
  txnId: string;
  recurringId: string;
  field: "payee" | "amount" | "date" | "category_id";
  oldValue: string;   // display string for modal
  newValue: string;   // display string for modal
  rawValue: unknown;  // actual new value for DB
}

function CashflowPage() {
  const db = useDb();
  const { toast } = useToast();
  const [month, setMonth] = useState(getCurrentMonth);
  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [pendingRecurringDelete, setPendingRecurringDelete] = useState<{ txnId: string; recurringId: string; date: string } | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState<{ ids: string[]; recurringCount: number } | null>(null);
  const clearSelectionRef = useRef<(() => void) | null>(null);
  const [pdfFiles, setPdfFiles] = useState<File[] | null>(null);
  const [pendingRecurringEdit, setPendingRecurringEdit] = useState<PendingRecurringEdit | null>(null);

  // Load persisted groupBy on mount
  useEffect(() => {
    getSetting(db, "cashflow_group_by").then((v) => {
      if (v) setGroupBy(v as GroupBy);
    });
  }, [db]);

  // Arrow left/right to navigate months (when not editing)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      setMonth((m) => stepMonth(m, e.key === "ArrowLeft" ? -1 : 1));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Swipe left/right to navigate months on mobile
  const touchRef = useRef<{ x: number; y: number; swiped: boolean } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (t) touchRef.current = { x: t.clientX, y: t.clientY, swiped: false };
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const start = touchRef.current;
    const t = e.touches[0];
    if (!start || !t || start.swiped) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Only trigger if horizontal movement dominates and exceeds threshold
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      start.swiped = true;
      setMonth((m) => stepMonth(m, dx > 0 ? -1 : 1));
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    touchRef.current = null;
  }, []);

  function handleGroupByChange(value: GroupBy) {
    setGroupBy(value);
    setSetting(db, "cashflow_group_by", value);
  }

  const { categories, add: addCategory } = useCategories();
  const {
    transactions,
    incomeGroups,
    expenseGroups,
    summary,
    loading,
    addTransaction,
    editTransaction,
    removeTransaction,
    removeTransactions,
    bulkEditTransactions,
    stopAndPurgeRecurrence,
    attachRecurrence,
    editRecurringInstance,
    deleteRecurringInstance,
    bulkDeleteRecurring,
  } = useCashflow(month, groupBy);

  const txnById = useMemo(() => {
    const map = new Map<string, (typeof transactions)[number]>();
    for (const t of transactions) map.set(t.id, t);
    return map;
  }, [transactions]);

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <PageHeader
        title="Cashflow"
        action={
          <div className="flex items-center gap-2">
            <PdfImportButton
                onFilesSelect={setPdfFiles}
                onFilesRejected={(names) =>
                  toast(`${names.join(", ")} exceeded 15 MB limit`, "error")
                }
              />
            <Button size="sm" onClick={() => setShowAddDialog(true)}>
              + Add
            </Button>
          </div>
        }
      />

      <CashflowToolbar
        month={month}
        onMonthChange={setMonth}
        groupBy={groupBy}
        onGroupByChange={handleGroupByChange}
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-text-muted">Loading...</p>
        </div>
      ) : (
        <SingleMonthView
          incomeGroups={incomeGroups}
          expenseGroups={expenseGroups}
          summary={summary}
          month={month}
          categories={categories}
          onToggleStatus={(id, newStatus) => {
            editTransaction(id, { status: newStatus });
          }}
          onDeleteRow={(id) => {
            const txn = txnById.get(id);
            if (txn?.recurring_id) {
              setPendingRecurringDelete({ txnId: id, recurringId: txn.recurring_id, date: txn.date });
            } else {
              setDeleteTarget(id);
            }
          }}
          onStopRecurrence={async (recurringId) => {
            await stopAndPurgeRecurrence(recurringId);
            toast("Recurrence stopped");
          }}
          onEditRow={async (id, updates) => {
            // Scope-sensitive fields on recurring instances show a modal
            const scopeFields = ["payee", "amount", "date"] as const;
            const scopeField = scopeFields.find((f) => f in updates);
            if (scopeField) {
              const { rows } = await db.exec<{ recurring_id: string | null; [k: string]: unknown }>(
                "SELECT recurring_id, payee, amount, date FROM transactions WHERE id = ?",
                [id]
              );
              const row = rows[0];
              if (row?.recurring_id) {
                const recurringId = row.recurring_id;
                const rawValue = updates[scopeField as keyof typeof updates];
                const formatVal = (f: string, v: unknown) =>
                  f === "amount" ? formatCurrency(v as number) : String(v);
                setPendingRecurringEdit({
                  txnId: id,
                  recurringId,
                  field: scopeField,
                  oldValue: formatVal(scopeField, row[scopeField]),
                  newValue: formatVal(scopeField, rawValue),
                  rawValue,
                });
                return;
              }
            }
            // category_id edits on recurring instances silently update the rule + all future planned instances
            if ("category_id" in updates) {
              const { rows: catRows } = await db.exec<{ recurring_id: string | null }>(
                "SELECT recurring_id FROM transactions WHERE id = ?",
                [id]
              );
              const recurringId = catRows[0]?.recurring_id;
              if (recurringId) {
                await editRecurringInstance(id, recurringId, "category_id", updates.category_id, "all");
                toast("Updated");
                return;
              }
            }
            await editTransaction(id, updates);
            toast("Updated");
          }}
          onCreateCategory={async (name, isIncome) => {
            const colors = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"] as const;
            const color = colors[Math.floor(Math.random() * colors.length)] ?? "#6366f1";
            const id = await addCategory({ name, color, is_income: isIncome });
            toast(`Category "${name}" created`);
            return id;
          }}
          onAddRow={async (data) => {
            await addTransaction({
              amount: data.amount,
              type: data.type,
              category_id: data.category_id,
              date: data.date,
              payee: data.payee,
              status: data.status,
              group_name: data.group_name,
              recurring: data.recurring,
            });
            toast(data.recurring ? "Recurring transaction added" : "Transaction added");
          }}
          onDuplicateRow={async (row) => {
            await addTransaction({
              amount: row.amount,
              type: row.type,
              category_id: row.categoryId,
              date: row.date,
              payee: row.label,
              status: "planned",
              group_name: row.groupName,
            });
            toast("Transaction duplicated");
          }}
          onAttachRecurrence={async (txnId, row, frequency) => {
            await attachRecurrence(txnId, row, frequency);
            toast("Recurring rule created");
          }}
          onBulkDeleteRequest={(ids, clearSelection) => {
            clearSelectionRef.current = clearSelection;
            const recurringCount = ids.filter((id) => txnById.get(id)?.recurring_id).length;
            setPendingBulkDelete({ ids, recurringCount });
          }}
          onBulkEditRows={async (ids, updates) => {
            await bulkEditTransactions(ids, updates);
          }}
        />
      )}

      {showAddDialog && (
        <AddRowDialog
          open={showAddDialog}
          onClose={() => setShowAddDialog(false)}
          month={month}
          categories={categories}
          onSubmit={async (data) => {
            await addTransaction({
              amount: data.amount,
              type: data.type,
              category_id: data.category_id,
              date: data.date,
              payee: data.payee,
              status: data.status,
              group_name: data.group_name,
              recurring: data.recurring,
            });
            toast("Transaction added");
          }}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await removeTransaction(deleteTarget);
            toast("Transaction deleted");
          }
          setDeleteTarget(null);
        }}
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />

      {pendingRecurringDelete && (
        <RecurringDeleteModal
          open={true}
          totalCount={1}
          recurringCount={1}
          onCancel={() => setPendingRecurringDelete(null)}
          onJustThis={async () => {
            const p = pendingRecurringDelete;
            setPendingRecurringDelete(null);
            await deleteRecurringInstance(p.txnId, p.recurringId, p.date, "one");
            toast("Transaction deleted");
          }}
          onAllFuture={async () => {
            const p = pendingRecurringDelete;
            setPendingRecurringDelete(null);
            await deleteRecurringInstance(p.txnId, p.recurringId, p.date, "all");
            toast("Recurrence stopped & future transactions deleted");
          }}
        />
      )}

      {/* Bulk delete: non-recurring → simple confirm, recurring → scope modal */}
      {pendingBulkDelete && pendingBulkDelete.recurringCount === 0 && (
        <ConfirmDialog
          open={true}
          onClose={() => { setPendingBulkDelete(null); }}
          onConfirm={async () => {
            const ids = pendingBulkDelete.ids;
            setPendingBulkDelete(null);
            await removeTransactions(ids);
            clearSelectionRef.current?.();
            toast(`${ids.length} transaction${ids.length !== 1 ? "s" : ""} deleted`);
          }}
          title={`Delete ${pendingBulkDelete.ids.length} Transaction${pendingBulkDelete.ids.length !== 1 ? "s" : ""}`}
          message={`Delete ${pendingBulkDelete.ids.length} transaction${pendingBulkDelete.ids.length !== 1 ? "s" : ""}? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
        />
      )}
      {pendingBulkDelete && pendingBulkDelete.recurringCount > 0 && (
        <RecurringDeleteModal
          open={true}
          totalCount={pendingBulkDelete.ids.length}
          recurringCount={pendingBulkDelete.recurringCount}
          onCancel={() => setPendingBulkDelete(null)}
          onJustThis={async () => {
            const { ids } = pendingBulkDelete;
            setPendingBulkDelete(null);
            const txnData = ids.map((id) => {
              const txn = txnById.get(id);
              return { id, recurring_id: txn?.recurring_id ?? null, date: txn?.date ?? "" };
            });
            await bulkDeleteRecurring(txnData, "one");
            clearSelectionRef.current?.();
            toast(`${ids.length} transaction${ids.length !== 1 ? "s" : ""} deleted`);
          }}
          onAllFuture={async () => {
            const { ids } = pendingBulkDelete;
            setPendingBulkDelete(null);
            // Reuse same txnData shape as onJustThis — only scope differs
            const txnData = ids.map((id) => {
              const txn = txnById.get(id);
              return { id, recurring_id: txn?.recurring_id ?? null, date: txn?.date ?? "" };
            });
            await bulkDeleteRecurring(txnData, "all");
            clearSelectionRef.current?.();
            toast("Recurrence stopped & future transactions deleted");
          }}
        />
      )}

      {pdfFiles && pdfFiles.length > 0 && (
        <PdfImportModal
          open={true}
          onClose={() => setPdfFiles(null)}
          files={pdfFiles}
          categories={categories}
        />
      )}

      {pendingRecurringEdit && (
        <RecurringScopeModal
          open={true}
          fieldLabel={pendingRecurringEdit.field === "category_id" ? "Category" : pendingRecurringEdit.field.charAt(0).toUpperCase() + pendingRecurringEdit.field.slice(1)}
          fromValue={pendingRecurringEdit.oldValue}
          toValue={pendingRecurringEdit.newValue}
          onCancel={() => setPendingRecurringEdit(null)}
          onJustThis={async () => {
            const p = pendingRecurringEdit;
            setPendingRecurringEdit(null);
            await editRecurringInstance(p.txnId, p.recurringId, p.field, p.rawValue, "one");
            toast("Updated");
          }}
          onAllFuture={async () => {
            const p = pendingRecurringEdit;
            setPendingRecurringEdit(null);
            await editRecurringInstance(p.txnId, p.recurringId, p.field, p.rawValue, "all");
            toast("Updated all future");
          }}
        />
      )}
    </div>
  );
}
