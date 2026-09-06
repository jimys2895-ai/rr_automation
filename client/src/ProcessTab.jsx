import { useState, useRef, useCallback } from "react";
import {
  Upload,
  FileText,
  X,
  Plus,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  Clock,
  RotateCcw,
  Loader2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Btn, Toast } from "./ui";
import * as api from "./api";

const SOURCE_TYPES = [
  { key: "bvd", label: "BVD Fuel" },
  { key: "easypass", label: "EZ Pass" },
  { key: "bluewater", label: "BlueWater" },
];

function FileCard({ files = [], onAdd, onRemove }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef(null);
  const accept = ".csv,.xlsx,.xls";

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) onAdd([...e.dataTransfer.files]);
      }}
      className={`relative flex flex-col items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed cursor-pointer transition-all select-none min-h-[76px] ${
        dragging
          ? "border-blue-400 bg-blue-50 scale-[1.02]"
          : files.length
            ? "border-blue-300 bg-blue-50/40"
            : "border-gray-200 hover:border-gray-300 bg-white"
      }`}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files.length) onAdd([...e.target.files]);
          e.target.value = "";
        }}
      />

      {files.length ? (
        <div
          className="w-full space-y-1"
          onClick={(e) => e.stopPropagation()}
        >
          {files.map((file, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <FileText size={13} className="text-blue-500 shrink-0" />
              <span
                className="text-xs text-blue-700 truncate flex-1"
                title={file.name}
              >
                {file.name}
              </span>
              <button
                className="text-gray-400 hover:text-red-500 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(i);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            onClick={() => ref.current?.click()}
            className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-600 pt-0.5"
          >
            <Plus size={11} /> Add more
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-0.5 h-9">
          <Upload size={15} className="text-gray-300" />
          <span className="text-xs text-gray-400">CSV / Excel</span>
        </div>
      )}
    </div>
  );
}

function ChargeRow({ charge }) {
  const [open, setOpen] = useState(false);
  const breakdown = charge.breakdown ?? [];
  const hasBreakdown = breakdown.length > 0;

  return (
    <div>
      <div className="flex items-center gap-3 text-sm">
        <div className="w-2 h-2 rounded-sm bg-emerald-100 shrink-0" />
        <span className="text-gray-700 font-medium w-32 shrink-0">
          {charge.type}
        </span>
        {charge.amountUsd != null && (
          <span className="text-gray-400">
            ${charge.amountUsd.toFixed(2)} USD →
          </span>
        )}
        <span className="font-semibold text-gray-900">
          ${charge.amountCad.toFixed(2)} CAD
        </span>
        {hasBreakdown && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="ml-auto flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-600"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {breakdown.length} day{breakdown.length !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {open && hasBreakdown && (
        <div className="mt-1.5 ml-5 pl-3 border-l border-gray-100 space-y-1">
          {breakdown.map((b, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs text-gray-500"
            >
              <span className="font-mono text-gray-400 w-24 shrink-0">
                {b.date}
              </span>
              <span className="text-gray-500">${b.amountUsd.toFixed(2)}</span>
              <span className="text-gray-300">×</span>
              <span className="text-gray-500">{b.rate}</span>
              <span className="text-gray-300">=</span>
              <span className="font-medium text-gray-700">
                ${b.amountCad.toFixed(2)} CAD
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProcessTab() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [files, setFiles] = useState({});
  const [phase, setPhase] = useState("input"); // 'input'|'processing'|'preview'|'confirming'|'done'
  const [jobData, setJobData] = useState(null);
  const [ignoredBillIds, setIgnoredBillIds] = useState(new Set());
  const [results, setResults] = useState(null);
  const [toasts, setToasts] = useState([]);

  const addFiles = (fk, newFiles) =>
    setFiles((p) => ({ ...p, [fk]: [...(p[fk] ?? []), ...newFiles] }));

  const removeFile = (fk, idx) =>
    setFiles((p) => ({ ...p, [fk]: (p[fk] ?? []).filter((_, i) => i !== idx) }));

  function toggleIgnore(billId) {
    setIgnoredBillIds((prev) => {
      const next = new Set(prev);
      next.has(billId) ? next.delete(billId) : next.add(billId);
      return next;
    });
  }

  const toast = useCallback((message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, message, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000);
  }, []);

  async function process() {
    if (!startDate || !endDate) {
      toast("Select a pay period start and end date", "error");
      return;
    }
    if (
      !SOURCE_TYPES.some(
        (st) => files[`${st.key}Usd`]?.length || files[`${st.key}Cad`]?.length,
      )
    ) {
      toast("Upload at least one source file", "error");
      return;
    }
    setPhase("processing");
    try {
      const fd = new FormData();
      fd.append("payPeriodStart", startDate);
      fd.append("payPeriodEnd", endDate);
      SOURCE_TYPES.forEach((st) => {
        ["Usd", "Cad"].forEach((cur) => {
          const fk = `${st.key}${cur}`;
          (files[fk] ?? []).forEach((f) => fd.append(fk, f));
        });
      });
      setJobData(await api.processCharges(fd));
      setPhase("preview");
    } catch (e) {
      toast(e.message, "error");
      setPhase("input");
    }
  }

  async function confirm() {
    setPhase("confirming");
    try {
      setResults(await api.confirmCharges(jobData.jobId, ignoredBillIds));
      setPhase("done");
    } catch (e) {
      toast(e.message, "error");
      setPhase("preview");
    }
  }

  function reset() {
    setPhase("input");
    setJobData(null);
    setIgnoredBillIds(new Set());
    setResults(null);
    setFiles({});
  }

  const toUpdate =
    jobData?.preview.filter(
      (p) => p.hasNewCharges && !ignoredBillIds.has(p.billId),
    ).length ?? 0;
  const skipped = jobData?.preview.filter((p) => !p.hasNewCharges).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Process Charges</h2>
        <p className="text-sm text-gray-400 mt-0.5">
          Upload source files, review the preview, then apply to RoseRocket
        </p>
      </div>

      {/* ── Input form ─────────────────────────────────────────────────────── */}
      {(phase === "input" || phase === "processing") && (
        <>
          {/* Pay period */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <p className="text-sm font-semibold text-gray-700 mb-4">
              Pay Period
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1.5">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <ArrowRight size={15} className="text-gray-300 mt-5 shrink-0" />
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1.5">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* File uploads */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <p className="text-sm font-semibold text-gray-700 mb-4">
              Source Files
            </p>
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-x-3 gap-y-1 mb-1">
              <div />
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">
                USD
              </p>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-center">
                CAD
              </p>
            </div>
            <div className="space-y-2">
              {SOURCE_TYPES.map((st) => (
                <div
                  key={st.key}
                  className="grid grid-cols-[1fr_1fr_1fr] gap-3 items-center"
                >
                  <p className="text-sm font-medium text-gray-700">
                    {st.label}
                  </p>
                  {["Usd", "Cad"].map((cur) => {
                    const fk = `${st.key}${cur}`;
                    return (
                      <FileCard
                        key={fk}
                        files={files[fk] ?? []}
                        onAdd={(newFiles) => addFiles(fk, newFiles)}
                        onRemove={(i) => removeFile(fk, i)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              All files optional - only uploaded files generate charges. Accepts
              .csv, .xlsx, .xls
            </p>
          </div>

          <div className="flex justify-end">
            <Btn
              onClick={process}
              disabled={phase === "processing"}
              className="px-6 py-2.5"
            >
              {phase === "processing" ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Processing
                </>
              ) : (
                <>
                  Process <ArrowRight size={14} />
                </>
              )}
            </Btn>
          </div>
        </>
      )}

      {/* ── Preview ────────────────────────────────────────────────────────── */}
      {(phase === "preview" || phase === "confirming") && jobData && (
        <>
          {/* Stats bar */}
          <div className="bg-green-900 rounded-xl px-5 py-4 flex items-center gap-4 text-sm flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-white">
                {jobData.payPeriodStart}
              </span>
              <ArrowRight size={12} className="text-gray-500" />
              <span className="font-semibold text-white">
                {jobData.payPeriodEnd}
              </span>
            </div>
            <div className="h-4 w-px bg-green-300 hidden sm:block" />
            <span className="inline-flex items-center gap-1.5">
              <span className="font-bold text-green-300">{toUpdate}</span>
              <span className="text-gray-300">
                bill{toUpdate !== 1 ? "s" : ""} to update
              </span>
            </span>
            {skipped > 0 && (
              <span className="text-gray-300">
                {skipped} with no new charges
              </span>
            )}
            <button
              onClick={reset}
              className="ml-auto flex items-center gap-1.5 text-green-300 hover:text-green-500 transition-colors"
            >
              <RotateCcw size={11} /> Start over
            </button>
          </div>

          {/* Warnings */}
          {jobData.warnings?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-2 text-amber-700 text-sm font-semibold mb-2">
                <AlertCircle size={14} /> Warnings
              </div>
              <ul className="space-y-1">
                {jobData.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="text-sm text-amber-600 flex items-start gap-2"
                  >
                    <span className="text-amber-400 shrink-0 mt-0.5">•</span>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Preview cards */}
          <div className="space-y-2">
            {jobData.preview.map((p) => {
              const ignored = ignoredBillIds.has(p.billId);
              return (
                <div
                  key={p.billId}
                  className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-opacity ${
                    ignored
                      ? "border-gray-200 opacity-50"
                      : p.hasNewCharges
                        ? "border-l-[3px] border-l-emerald-400 border-gray-200"
                        : "border-gray-200 opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${ignored ? "bg-gray-300" : p.hasNewCharges ? "bg-emerald-400" : "bg-gray-300"}`}
                    />
                    <span
                      className={`text-sm font-semibold ${ignored ? "text-gray-400 line-through" : "text-gray-900"}`}
                    >
                      {p.driverDisplayName}
                    </span>
                    {p.billNumber && (
                      <a
                        href={p.billUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-blue-400 hover:text-blue-600 font-mono underline underline-offset-2"
                      >
                        {p.billNumber}
                      </a>
                    )}
                    {!p.hasNewCharges && !ignored && (
                      <span className="ml-auto text-xs text-gray-400">
                        No new charges
                      </span>
                    )}
                    {p.hasNewCharges && (
                      <button
                        onClick={() => toggleIgnore(p.billId)}
                        className={`ml-auto flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                          ignored
                            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                            : "bg-red-100 text-red-600 hover:bg-red-200"
                        }`}
                      >
                        {ignored ? (
                          <>
                            <RotateCcw size={11} /> Approve
                          </>
                        ) : (
                          <>
                            <X size={11} /> Reject
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {p.charges.length > 0 && (
                    <div className="px-4 pb-3 pt-0 border-t border-gray-50">
                      <div className="mt-2 space-y-1.5">
                        {p.charges.map((c, i) => (
                          <ChargeRow key={i} charge={c} />
                        ))}
                      </div>
                    </div>
                  )}

                  {p.alreadyPosted?.length > 0 && (
                    <div className="px-4 pb-3 pt-2 border-t border-gray-50 bg-gray-50/50 flex flex-wrap gap-1.5">
                      {p.alreadyPosted.map((a, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full"
                        >
                          <CheckCircle size={9} /> {a.type} already posted
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {toUpdate > 0 && (
            <div className="flex justify-end">
              <Btn
                onClick={confirm}
                disabled={phase === "confirming"}
                className="px-6 py-2.5"
              >
                {phase === "confirming" ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Applying
                  </>
                ) : (
                  <>
                    Confirm &amp; Apply to RoseRocket <ArrowRight size={14} />
                  </>
                )}
              </Btn>
            </div>
          )}
        </>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {phase === "done" && results && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                label: "Updated",
                value: results.results.filter((r) => r.status === "updated")
                  .length,
                color: "emerald",
              },
              {
                label: "Skipped",
                value: results.results.filter((r) => r.status === "skipped")
                  .length,
                color: "gray",
              },
              {
                label: "Errors",
                value: results.results.filter((r) => r.status === "error")
                  .length,
                color: "red",
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center"
              >
                <p className={`text-3xl font-bold text-${color}-600`}>
                  {value}
                </p>
                <p className="text-sm text-gray-500 mt-1">{label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {results.results.map((r, i) => (
              <div
                key={i}
                className="flex items-start gap-3 px-4 py-3 border-t border-gray-100 first:border-t-0"
              >
                {r.status === "updated" ? (
                  <CheckCircle
                    size={15}
                    className="text-emerald-500 mt-0.5 shrink-0"
                  />
                ) : r.status === "error" ? (
                  <AlertCircle
                    size={15}
                    className="text-red-500 mt-0.5 shrink-0"
                  />
                ) : (
                  <Clock size={15} className="text-gray-300 mt-0.5 shrink-0" />
                )}
                <span className="text-sm font-medium text-gray-900 w-48 shrink-0">
                  {r.driverDisplayName}
                </span>
                {r.status === "updated" && (
                  <span className="text-xs text-gray-500 leading-5">
                    {r.charges
                      .map((c) => `${c.type}: $${c.amountCad.toFixed(2)} CAD`)
                      .join(" · ")}
                  </span>
                )}
                {r.status === "error" && (
                  <span className="text-xs text-red-500">{r.message}</span>
                )}
                {r.status === "skipped" && (
                  <span className="text-xs text-gray-400">
                    No new charges to add
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Btn variant="secondary" onClick={reset}>
              <RotateCcw size={13} /> Process Another Period
            </Btn>
          </div>
        </>
      )}

      <Toast toasts={toasts} />
    </div>
  );
}
