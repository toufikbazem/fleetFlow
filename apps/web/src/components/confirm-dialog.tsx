/**
 * Dialogs — FF-1102 / FF-1105.
 *
 * Used for every destructive or irreversible action and for every create/edit
 * form in the product. Radix supplies the focus trap, escape handling and
 * `aria-modal` semantics — the parts that are tedious to get right and
 * dangerous to get wrong.
 *
 * Both dialogs share one shell so they open the same way, sit at the same
 * elevation and close from the same control. On a phone the shell docks to the
 * bottom of the screen instead of floating in the middle: a driver's thumb
 * reaches the bottom third of a phone and not the centre, and the on-screen
 * keyboard would push a centred dialog off the top anyway.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const overlayClass = [
  'fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]',
  'data-[state=open]:animate-fade-in',
].join(' ');

const contentClass = [
  'fixed z-50 flex flex-col border border-border bg-card shadow-lg',
  // Phone: a sheet docked to the bottom edge, full width.
  'inset-x-0 bottom-0 max-h-[92vh] rounded-t-2xl',
  'data-[state=open]:animate-slide-up',
  // Tablet and up: a centred panel.
  'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[calc(100vh-4rem)]',
  'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
  'sm:data-[state=open]:animate-scale-in',
].join(' ');

function DialogChrome({
  title,
  description,
  children,
  className,
  dismissible = true,
  icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dismissible?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
        {icon}
        <div className="min-w-0 flex-1">
          <Dialog.Title className="text-base font-semibold leading-tight tracking-tight">
            {title}
          </Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {description}
            </Dialog.Description>
          ) : null}
        </div>

        {dismissible ? (
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon-sm" className="-mr-1.5 -mt-1 shrink-0">
              <X className="size-4" aria-hidden />
              <span className="sr-only">Close</span>
            </Button>
          </Dialog.Close>
        ) : null}
      </div>

      {/* The body scrolls, the header and the footer inside it do not, so the
          action a long form is asking for never scrolls out of reach. */}
      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6',
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Awaited; the dialog shows a pending state and closes on success. */
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);

  async function handleConfirm(): Promise<void> {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Left open on failure: the caller surfaces the error, and closing would
      // hide it behind the screen the user was trying to act on.
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClass} />
        <Dialog.Content
          className={cn(contentClass, 'sm:w-[calc(100vw-2rem)] sm:max-w-md')}
          // Escape and outside-click are disabled mid-flight so a half-finished
          // request cannot be abandoned into an unknown state.
          onEscapeKeyDown={(event) => pending && event.preventDefault()}
          onPointerDownOutside={(event) => pending && event.preventDefault()}
        >
          <DialogChrome
            title={title}
            {...(description ? { description } : {})}
            dismissible={!pending}
            icon={
              destructive ? (
                // The warning mark carries the weight, so the sentence does not
                // have to shout and the buttons stay a normal size.
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive-soft text-destructive">
                  <AlertTriangle className="size-4.5" aria-hidden />
                </span>
              ) : undefined
            }
          >
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close asChild>
                <Button variant="outline" disabled={pending} className="w-full sm:w-auto">
                  {cancelLabel}
                </Button>
              </Dialog.Close>
              <Button
                variant={destructive ? 'destructive' : 'default'}
                onClick={() => void handleConfirm()}
                disabled={pending}
                className="w-full sm:w-auto"
              >
                {pending ? <Spinner /> : null}
                {confirmLabel}
              </Button>
            </div>
          </DialogChrome>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Form dialog: the same shell, with the caller supplying the body and footer. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** `lg` for the multi-column forms — vehicle, document, plan. */
  size?: 'md' | 'lg';
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClass} />
        <Dialog.Content
          className={cn(
            contentClass,
            'sm:w-[calc(100vw-2rem)]',
            size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
          )}
        >
          <DialogChrome title={title} {...(description ? { description } : {})}>
            {children}
          </DialogChrome>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
