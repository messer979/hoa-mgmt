"use client";

import { useRef, useState, useTransition } from "react";

type Props = {
  triggerLabel: React.ReactNode;
  triggerClassName?: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  /** If set, the user must type this exact value before Confirm enables. */
  typeToConfirm?: string;
  /** Hidden form fields included in the submitted FormData. */
  hidden?: Record<string, string>;
  /** Server action invoked on confirm. */
  action: (formData: FormData) => Promise<unknown> | unknown;
  /** Visual treatment for the confirm button. */
  variant?: "destructive" | "primary";
};

export function ConfirmDialog({
  triggerLabel,
  triggerClassName = "btn",
  title,
  description,
  confirmLabel,
  typeToConfirm,
  hidden,
  action,
  variant = "destructive",
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  const open = () => {
    setTyped("");
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  const canConfirm = !typeToConfirm || typed.trim() === typeToConfirm.trim();
  const confirmClass = variant === "destructive" ? "btn-reject" : "btn-primary";

  return (
    <>
      <button type="button" className={triggerClassName} onClick={open}>
        {triggerLabel}
      </button>
      <dialog
        ref={dialogRef}
        className="rounded-lg border border-border bg-bg text-fg p-0 backdrop:bg-black/40 w-[min(28rem,calc(100vw-2rem))]"
        onClose={() => setTyped("")}
      >
        <div className="p-4 space-y-3">
          <h2 className="font-semibold">{title}</h2>
          <div className="text-sm text-muted">{description}</div>
          {typeToConfirm && (
            <div>
              <label className="label">
                Type <code className="text-fg">{typeToConfirm}</code> to confirm
              </label>
              <input
                className="input"
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" className="btn" onClick={close} disabled={pending}>
              Cancel
            </button>
            <form
              action={(fd) => {
                startTransition(async () => {
                  await action(fd);
                  dialogRef.current?.close();
                });
              }}
            >
              {Object.entries(hidden ?? {}).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <button className={confirmClass} disabled={!canConfirm || pending}>
                {pending ? "Working…" : confirmLabel}
              </button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
