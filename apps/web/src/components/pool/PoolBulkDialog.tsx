import { Download, Plus, Trash2, Upload, UserPlus, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { createPortal } from "react-dom";
import { errorMessage, isApiError } from "../../api/client";
import { useImportPoolStudents } from "../../api/admin";
import { useModalBehavior } from "../../hooks/useModalBehavior";
import {
  ELIGIBILITY_STATUSES,
  type PoolBulkField,
  type PoolBulkProblem,
  type PoolBulkRow,
  type PoolProduct,
} from "../../types/api";
import { cn } from "../../utils/cn";
import { parseDelimited } from "../../utils/delimited";
import { formatNumber } from "../../utils/format";
import { useToast } from "../toast-context";
import { Button, IconButton, buttonClass } from "../ui/Button";

interface Column {
  key: PoolBulkField;
  label: string;
  required?: boolean;
  width: string;
  max: number;
  aliases: string[];
}

const COLUMNS: Column[] = [
  {
    key: "studentId",
    label: "User ID",
    required: true,
    width: "min-w-72",
    max: 100,
    aliases: ["user id", "userid", "uuid", "student user id", "learning portal user id"],
  },
  { key: "niatId", label: "NIAT ID", width: "min-w-36", max: 50, aliases: ["niat id", "niatid", "student id"] },
  { key: "studentName", label: "Name", required: true, width: "min-w-56", max: 200, aliases: ["name", "student name", "full name"] },
  { key: "mobile", label: "Mobile", width: "min-w-40", max: 20, aliases: ["mobile", "mobile number", "phone", "phone number", "contact"] },
  { key: "email", label: "Email", width: "min-w-60", max: 200, aliases: ["email", "email id", "email address", "mail"] },
  { key: "productGroup", label: "Product", required: true, width: "min-w-28", max: 20, aliases: ["product", "product group"] },
  { key: "campus", label: "Campus", width: "min-w-60", max: 200, aliases: ["campus", "college", "university", "institute"] },
  { key: "batch", label: "Batch", width: "min-w-24", max: 20, aliases: ["batch", "pass out year", "passout year", "year"] },
  {
    key: "eligibilityStatus",
    label: "Eligibility Status",
    width: "min-w-40",
    max: 40,
    aliases: ["eligibility status", "status", "eligibility"],
  },
  { key: "remarks", label: "Remarks", width: "min-w-56", max: 500, aliases: ["remarks", "remark", "notes", "note"] },
];

const TEMPLATE_URL = "/eligible-pool-template.csv";
const START_ROWS = 15;
const GRID_LIMIT = 500;
const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE = /^\+?[0-9 -]*$/;

type Grid = string[][];
type Problems = Map<string, string>;

const columnIndex = (key: PoolBulkField) => COLUMNS.findIndex((column) => column.key === key);
const emptyRow = () => COLUMNS.map(() => "");
const blankGrid = () => Array.from({ length: START_ROWS }, emptyRow);
const isEmptyRow = (row: string[]) => row.every((cell) => cell.trim() === "");
const cellOf = (row: string[] | undefined, index: number) => row?.[index] ?? "";
const cellKey = (row: number, column: number) => `${row}:${column}`;
const headerKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function columnForHeader(text: string): number | null {
  const index = COLUMNS.findIndex((column) => column.aliases.includes(headerKey(text)));
  return index === -1 ? null : index;
}

const looksLikeHeader = (cells: string[] | undefined) =>
  (cells ?? []).filter((cell) => columnForHeader(cell) !== null).length >= 2;

const matchValue = (values: readonly string[], value: string) =>
  values.find((option) => option.toLowerCase() === value.trim().toLowerCase());

function validate(grid: Grid, products: readonly PoolProduct[]) {
  const problems: Problems = new Map();
  const firstRow = new Map<string, number>();
  let ready = 0;
  grid.forEach((row, r) => {
    if (isEmptyRow(row)) return;
    ready += 1;
    const value = (key: PoolBulkField) => cellOf(row, columnIndex(key)).trim();
    const add = (key: PoolBulkField, message: string) => {
      const at = cellKey(r, columnIndex(key));
      if (!problems.has(at)) problems.set(at, message);
    };
    COLUMNS.forEach((column) => {
      if (value(column.key).length > column.max) add(column.key, `${column.label} is longer than ${column.max} characters`);
    });
    const id = value("studentId");
    if (!id) add("studentId", "User ID is required");
    else if (firstRow.has(id)) add("studentId", `Same user ID as row ${(firstRow.get(id) ?? 0) + 1}`);
    else firstRow.set(id, r);
    if (!value("studentName")) add("studentName", "Name is required");
    const product = value("productGroup");
    if (!product && products.length !== 1) add("productGroup", `Product is required: ${products.join(" or ")}`);
    else if (product && !matchValue(products, product)) add("productGroup", `Product must be ${products.join(" or ")}`);
    const status = value("eligibilityStatus");
    if (status && !matchValue(ELIGIBILITY_STATUSES, status)) {
      add("eligibilityStatus", `Use one of: ${ELIGIBILITY_STATUSES.join(", ")} (empty means Eligible)`);
    }
    const email = value("email");
    if (email && !EMAIL.test(email)) add("email", "Not a valid email address");
    const mobile = value("mobile");
    if (mobile && !MOBILE.test(mobile)) add("mobile", "Use only digits, spaces, - and a leading +");
  });
  return { problems, ready };
}

function toPayload(grid: Grid, products: readonly PoolProduct[]) {
  const students: PoolBulkRow[] = [];
  const gridRows: number[] = [];
  grid.forEach((row, r) => {
    if (isEmptyRow(row)) return;
    const student = Object.fromEntries(COLUMNS.map((column, c) => [column.key, cellOf(row, c).trim()])) as PoolBulkRow;
    student.productGroup =
      matchValue(products, student.productGroup) ?? (student.productGroup || (products.length === 1 ? (products[0] ?? "") : ""));
    student.eligibilityStatus = matchValue(ELIGIBILITY_STATUSES, student.eligibilityStatus) ?? student.eligibilityStatus;
    students.push(student);
    gridRows.push(r);
  });
  return { students, gridRows };
}

function rowsFromTable(table: string[][], startColumn: number) {
  const [first, ...rest] = table;
  const header = looksLikeHeader(first);
  const map = header
    ? (first ?? []).map(columnForHeader)
    : Array.from({ length: Math.max(0, ...table.map((cells) => cells.length)) }, (_, j) =>
        startColumn + j < COLUMNS.length ? startColumn + j : null,
      );
  const columns = map.filter((column): column is number => column !== null);
  const rows = (header ? rest : table).map((cells) => {
    const row = emptyRow();
    cells.forEach((value, j) => {
      const column = map[j];
      if (column !== null && column !== undefined) row[column] = value.trim();
    });
    return row;
  });
  return { rows, columns };
}

interface ServerResult {
  message: string;
  problems: Problems;
}

interface PoolBulkDialogProps {
  open: boolean;
  products: readonly PoolProduct[];
  onClose: () => void;
}

export function PoolBulkDialog({ open, products, onClose }: PoolBulkDialogProps) {
  if (!open) return null;
  return <PoolBulkForm products={products} onClose={onClose} />;
}

function PoolBulkForm({ products, onClose }: { products: readonly PoolProduct[]; onClose: () => void }) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const firstCellRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [grid, setGrid] = useState<Grid>(blankGrid);
  const [source, setSource] = useState<"CSV" | "PASTE">("PASTE");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [server, setServer] = useState<ServerResult | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const importStudents = useImportPoolStudents();
  const toast = useToast();
  const pending = importStudents.isPending;

  const hasData = grid.some((row) => !isEmptyRow(row));
  const { problems: clientProblems, ready } = useMemo(() => validate(grid, products), [grid, products]);
  const problems = useMemo(() => new Map([...(server?.problems ?? []), ...clientProblems]), [server, clientProblems]);
  const problemRows = new Set([...problems.keys()].map((key) => Number(key.split(":")[0]))).size;
  const problemList = useMemo(
    () =>
      [...problems.entries()]
        .map(([key, message]) => {
          const [row = 0, column = 0] = key.split(":").map(Number);
          return { row, column, message };
        })
        .sort((a, b) => a.row - b.row || a.column - b.column),
    [problems],
  );

  const close = () => {
    if (pending) return;
    if (hasData && !window.confirm("Close and discard the rows you added?")) return;
    onClose();
  };
  useModalBehavior(true, panelRef, close, firstCellRef);

  const changeGrid = (update: (current: Grid) => Grid) => {
    setGrid((current) => {
      const next = update(current);
      return next.length ? next : blankGrid();
    });
    setServer(null);
  };

  const setCell = (r: number, c: number, value: string) =>
    changeGrid((current) => current.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row)));

  const onPaste = (r: number, c: number) => (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text/plain");
    if (!/[\t\r\n]/.test(text.replace(/[\r\n]+$/, ""))) return;
    event.preventDefault();
    const pasted = rowsFromTable(parseDelimited(text, "\t"), c);
    if (!pasted.rows.length || !pasted.columns.length) return;
    if (r + pasted.rows.length > MAX_ROWS) {
      setFileError(`You can add at most ${formatNumber(MAX_ROWS)} students at a time.`);
      return;
    }
    changeGrid((current) => {
      const next = current.map((row) => [...row]);
      pasted.rows.forEach((cells, i) => {
        const target = r + i;
        while (next.length <= target) next.push(emptyRow());
        const row = next[target] ?? emptyRow();
        for (const column of pasted.columns) row[column] = cells[column] ?? "";
        next[target] = row;
      });
      return next;
    });
    setFileError(null);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setFileError("Choose a .csv file. In Excel or Google Sheets use File → Download or Save as → CSV.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError("The file is larger than 5 MB.");
      return;
    }
    const table = parseDelimited(await file.text(), ",");
    if (!looksLikeHeader(table[0])) {
      setFileError("The first row of the file must be the column headers from the template: User ID, NIAT ID, Name, …");
      return;
    }
    const headers = (table[0] ?? []).map(columnForHeader);
    if (!headers.includes(columnIndex("studentId")) || !headers.includes(columnIndex("studentName"))) {
      setFileError("The file needs at least the User ID and Name columns. Download the template to see every column.");
      return;
    }
    const { rows } = rowsFromTable(table, 0);
    if (!rows.length) {
      setFileError("The file has no student rows under the headers.");
      return;
    }
    if (rows.length > MAX_ROWS) {
      setFileError(`The file has ${formatNumber(rows.length)} rows. Add at most ${formatNumber(MAX_ROWS)} at a time.`);
      return;
    }
    if (hasData && !window.confirm("Replace the rows already in the grid with this file?")) return;
    setGrid(rows);
    setServer(null);
    setFileName(file.name);
    setFileError(null);
    setSource("CSV");
  };

  const submit = () => {
    if (!ready || clientProblems.size) return;
    const payload = toPayload(grid, products);
    importStudents.mutate(
      { students: payload.students, updateExisting, source },
      {
        onSuccess: ({ result }) => {
          toast.success(
            `${formatNumber(result.added)} students added to the eligible pool${result.updated ? `, ${formatNumber(result.updated)} updated` : ""}`,
          );
          onClose();
        },
        onError: (err) => {
          const found: Problems = new Map();
          if (isApiError(err) && err.code === "BULK_INVALID" && Array.isArray(err.details)) {
            for (const problem of err.details as PoolBulkProblem[]) {
              const gridRow = payload.gridRows[problem.row - 1];
              if (gridRow === undefined) continue;
              const column = Math.max(0, COLUMNS.findIndex((item) => item.key === problem.field));
              found.set(cellKey(gridRow, column), problem.message);
            }
          }
          setServer({ message: errorMessage(err, "The students could not be added."), problems: found });
        },
      },
    );
  };

  const visibleRows = grid.slice(0, GRID_LIMIT);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/30" aria-hidden onMouseDown={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        className="relative flex h-[92dvh] w-full max-w-[1280px] animate-pop-in flex-col rounded-xl border bg-surface shadow-pop outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-lg font-bold text-ink">
              Add students in bulk
            </h2>
            <p className="mt-0.5 text-sm text-muted">Upload the CSV template, or paste rows from Excel or Google Sheets.</p>
          </div>
          <IconButton label="Close" className="size-8 border-transparent shadow-none" onClick={close}>
            <X className="size-4" aria-hidden />
          </IconButton>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <a href={TEMPLATE_URL} download className={cn(buttonClass("secondary", "sm"), "gap-2")}>
              <Download className="size-4" aria-hidden />
              Download CSV template
            </a>
            <Button size="sm" variant="secondary" icon={<Upload className="size-4" aria-hidden />} onClick={() => fileRef.current?.click()}>
              Upload CSV file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-label="CSV file"
              onChange={(event) => void onFile(event)}
            />
            {fileName && <span className="text-xs text-muted">Loaded {fileName}</span>}
            <div className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="size-4" aria-hidden />}
                onClick={() => changeGrid((current) => [...current, ...Array.from({ length: 10 }, emptyRow)])}
                disabled={grid.length >= MAX_ROWS}
              >
                Add 10 rows
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 className="size-4" aria-hidden />}
                onClick={() => {
                  if (window.confirm("Clear every row in the grid?")) {
                    changeGrid(() => blankGrid());
                    setFileName(null);
                    setSource("PASTE");
                  }
                }}
                disabled={!hasData}
              >
                Clear all
              </Button>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted">
            To paste, copy the rows in Excel or Google Sheets, click the first cell here and press Ctrl+V. The header row can be
            included. <span className="font-semibold text-ink">User ID</span>, <span className="font-semibold text-ink">Name</span>{" "}
            and <span className="font-semibold text-ink">Product</span> ({products.join(" or ")}) are required.{" "}
            <span className="font-semibold text-ink">Eligibility Status</span> is <span className="font-semibold text-ink">Eligible</span>{" "}
            when left empty; other values: {ELIGIBILITY_STATUSES.filter((status) => status !== "Eligible").join(", ")}.
          </p>

          {fileError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {fileError}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Students to add</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky top-0 left-0 z-20 w-12 border-r border-b bg-slate-50 px-2 py-2 text-xs text-muted">
                    #
                  </th>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={cn(
                        "sticky top-0 z-10 border-r border-b bg-slate-50 px-2 py-2 text-left text-xs font-bold tracking-wider whitespace-nowrap text-muted uppercase",
                        column.width,
                      )}
                    >
                      {column.label}
                      {column.required && <span className="ml-0.5 text-red-500">*</span>}
                    </th>
                  ))}
                  <th scope="col" className="sticky top-0 z-10 w-10 border-b bg-slate-50">
                    <span className="sr-only">Remove row</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, r) => (
                  <tr key={r}>
                    <th
                      scope="row"
                      className="sticky left-0 z-[1] border-r border-b bg-slate-50 px-2 text-center text-xs font-normal text-muted tabular-nums"
                    >
                      {r + 1}
                    </th>
                    {COLUMNS.map((column, c) => {
                      const problem = problems.get(cellKey(r, c));
                      return (
                        <td key={column.key} className={cn("border-r border-b p-0", problem && "bg-red-50")}>
                          <input
                            ref={r === 0 && c === 0 ? firstCellRef : undefined}
                            value={cellOf(row, c)}
                            onChange={(event) => setCell(r, c, event.target.value)}
                            onPaste={onPaste(r, c)}
                            aria-label={`${column.label}, row ${r + 1}`}
                            aria-invalid={problem ? true : undefined}
                            title={problem}
                            placeholder={column.key === "eligibilityStatus" ? "Eligible" : undefined}
                            autoComplete="off"
                            spellCheck={false}
                            className={cn(
                              "h-9 w-full bg-transparent px-2 text-sm text-ink outline-none placeholder:text-slate-300 focus:bg-primary-soft/40 focus:ring-2 focus:ring-primary focus:ring-inset",
                              problem && "text-red-700",
                            )}
                          />
                        </td>
                      );
                    })}
                    <td className="border-b px-1">
                      <IconButton
                        label={`Remove row ${r + 1}`}
                        className="size-7 border-transparent shadow-none"
                        onClick={() => changeGrid((current) => current.filter((_, i) => i !== r))}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {grid.length > GRID_LIMIT && (
            <p className="text-xs text-muted">
              Showing the first {formatNumber(GRID_LIMIT)} of {formatNumber(grid.length)} rows. Every row will be added; rows with
              problems are listed below.
            </p>
          )}

          {(server || problemList.length > 0) && (
            <div role="alert" className="max-h-40 shrink-0 overflow-y-auto rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-semibold">
                {server?.message ??
                  `${formatNumber(problemRows)} ${problemRows === 1 ? "row needs" : "rows need"} fixing before the students can be added.`}
              </p>
              {problemList.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {problemList.slice(0, 100).map((item) => (
                    <li key={cellKey(item.row, item.column)}>
                      Row {item.row + 1} · {COLUMNS[item.column]?.label ?? "Row"}: {item.message}
                    </li>
                  ))}
                </ul>
              )}
              {problemList.length > 100 && <p className="mt-1">…and {formatNumber(problemList.length - 100)} more.</p>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <label className="flex max-w-xl items-start gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={updateExisting}
              onChange={(event) => {
                setUpdateExisting(event.target.checked);
                setServer(null);
              }}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              Update students already in the pool
              <span className="block text-xs text-muted">
                Otherwise a user ID that is already in the pool is shown as a problem. Empty cells never clear saved values.
              </span>
            </span>
          </label>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">
              {formatNumber(ready)} {ready === 1 ? "student" : "students"} ready
            </span>
            <Button variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              loading={pending}
              disabled={!ready || clientProblems.size > 0}
              icon={<UserPlus className="size-4" aria-hidden />}
            >
              {ready ? `Add ${formatNumber(ready)} ${ready === 1 ? "student" : "students"}` : "Add students"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
