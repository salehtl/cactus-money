import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { PageHeader } from "../components/layout/PageHeader.tsx";
import { Button } from "../components/ui/Button.tsx";
import { ConfirmDialog } from "../components/ui/ConfirmDialog.tsx";
import { RecurringScopeModal } from "../components/ui/RecurringScopeModal.tsx";
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
import { getCurrentMonth, formatCurrency } from "../lib/format.ts";
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
  const [pdfFiles, setPdfFiles] = useState<File[] | null>(null);
  const [pendingRecurringEdit, setPendingRecurringEdit] = useState<PendingRecurringEdit | null>(null);

  // Load persisted groupBy on mount
  useEffect(() => {
    getSetting(db, "cashflow_group_by").then((v) => {
      if (v) setGroupBy(v as GroupBy);
    });
  }, [db]);

  function handleGroupByChange(value: GroupBy) {
    setGroupBy(value);
    setSetting(db, "cashflow_group_by", value);
  }

  const { categories, add: addCategory } = useCategories();
  const {
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
    updateRecurringFrequency,
    editRecurringInstance,
  } = useCashflow(month, groupBy);

  return (
    <div>
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
          onDeleteRow={(id) => setDeleteTarget(id)}
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
          onUpdateRecurringFrequency={async (recurringId, frequency) => {
            await updateRecurringFrequency(recurringId, frequency);
            toast("Frequency updated");
          }}
          onBulkDeleteRows={async (ids) => {
            await removeTransactions(ids);
            toast(`${ids.length} transaction${ids.length !== 1 ? "s" : ""} deleted`);
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
