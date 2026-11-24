// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import {
  dismissTopOverlay,
  hasOpenOverlay,
  observeOpenOverlay,
} from "./overlay-dismiss";

const h = React.createElement;

afterEach(cleanup);

function ControlledDialog() {
  const [open, setOpen] = React.useState(true);
  return h(
    Dialog,
    { open, onOpenChange: setOpen },
    h(DialogContent, null, h(DialogTitle, null, "Test Dialog")),
  );
}

function ControlledAlertDialog() {
  const [open, setOpen] = React.useState(true);
  return h(
    AlertDialog,
    { open, onOpenChange: setOpen },
    h(
      AlertDialogContent,
      null,
      h(AlertDialogTitle, null, "Delete item?"),
      h(AlertDialogCancel, null, "Cancel"),
    ),
  );
}

function ControlledPopover() {
  const [open, setOpen] = React.useState(true);
  return h(
    Popover,
    { open, onOpenChange: setOpen },
    h(PopoverTrigger, null, "Info"),
    h(PopoverContent, null, "Popover body"),
  );
}

function ControlledSelect() {
  const [open, setOpen] = React.useState(true);
  return h(
    Select,
    { open, onOpenChange: setOpen, defaultValue: "a" },
    h(SelectTrigger, null, h(SelectValue, null)),
    h(SelectContent, null, h(SelectItem, { value: "a" }, "Alpha")),
  );
}

function NestedMenuInsideSheet() {
  const [sheetOpen, setSheetOpen] = React.useState(true);
  const [menuOpen, setMenuOpen] = React.useState(true);
  return h(
    Sheet,
    { open: sheetOpen, onOpenChange: setSheetOpen },
    h(
      SheetContent,
      null,
      h(SheetTitle, null, "Drawer"),
      h(
        DropdownMenu,
        { open: menuOpen, onOpenChange: setMenuOpen },
        h(DropdownMenuTrigger, null, "Actions"),
        h(DropdownMenuContent, null, h(DropdownMenuItem, null, "Delete")),
      ),
    ),
  );
}

async function expectSingleDismiss() {
  expect(hasOpenOverlay()).toBe(true);
  act(() => {
    expect(dismissTopOverlay()).toBe(true);
  });
  await waitFor(() => expect(hasOpenOverlay()).toBe(false));
}

describe("overlay-dismiss", () => {
  it("returns false when no overlay is open and ignores open Tooltips", async () => {
    render(
      h(
        TooltipProvider,
        { delay: 0 },
        h(
          Tooltip,
          { defaultOpen: true },
          h(TooltipTrigger, null, "Hover me"),
          h(TooltipContent, null, "Hint"),
        ),
      ),
    );
    await waitFor(() => {
      expect(
        document.querySelector('[data-slot="tooltip-content"]'),
      ).not.toBeNull();
    });
    expect(hasOpenOverlay()).toBe(false);
    expect(dismissTopOverlay()).toBe(false);
  });

  it("detects and dismisses Dialog, AlertDialog, Popover, and Select", async () => {
    for (const [Component, useIntl] of [
      [ControlledDialog, true],
      [ControlledAlertDialog, false],
      [ControlledPopover, false],
      [ControlledSelect, false],
    ] as const) {
      const view = useIntl
        ? renderWithIntl(h(Component))
        : render(h(Component));
      await expectSingleDismiss();
      view.unmount();
    }
  });

  it("dismisses a nested DropdownMenu inside a Sheet before closing the Sheet", async () => {
    renderWithIntl(h(NestedMenuInsideSheet));
    expect(
      document.querySelector('[data-open][data-slot="dropdown-menu-content"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-open][role="dialog"]'),
    ).not.toBeNull();

    act(() => {
      expect(dismissTopOverlay()).toBe(true);
    });
    await waitFor(() => {
      expect(
        document.querySelector(
          '[data-open][data-slot="dropdown-menu-content"]',
        ),
      ).toBeNull();
    });
    expect(
      document.querySelector('[data-open][role="dialog"]'),
    ).not.toBeNull();
    expect(hasOpenOverlay()).toBe(true);

    await expectSingleDismiss();
  });

  it("observes overlay open/close transitions via MutationObserver", async () => {
    const onChange = vi.fn();
    const stop = observeOpenOverlay(onChange);

    function ToggleableDialog() {
      const [open, setOpen] = React.useState(false);
      return h(
        "div",
        null,
        h("button", { type: "button", onClick: () => setOpen(true) }, "Open"),
        h(
          Dialog,
          { open, onOpenChange: setOpen },
          h(DialogContent, null, h(DialogTitle, null, "Observed")),
        ),
      );
    }

    const view = renderWithIntl(h(ToggleableDialog));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(true));

    act(() => {
      dismissTopOverlay();
    });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(false));

    stop();
  });
});
