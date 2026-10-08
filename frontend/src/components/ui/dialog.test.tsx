import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stubMatchMedia } from "@/test/test-utils";
import { Combobox } from "./combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./dialog";

function withMobileViewport(fn: () => void) {
  const originalWidth = window.innerWidth
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 375,
  })
  fn()
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: originalWidth,
  })
}

describe("DialogContent", () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    })
  })

  it("closes an open combobox on Escape before closing the dialog", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Test Dialog</DialogTitle>
          <Combobox value="" onChange={vi.fn()} options={[{ value: "a", label: "Alpha" }]} ariaLabel="Choice" />
        </DialogContent>
      </Dialog>
    );
    const combobox = screen.getByRole("combobox", { name: "Choice" });

    await user.click(combobox);
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("applies safe-area padding when fullscreen prop is true", () => {
    render(
      <Dialog open>
        <DialogContent fullscreen data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
  });

  it("applies safe-area padding when mobileFullscreen prop is true", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
  });

  it("applies inset-0 for fullscreen dialogs", () => {
    render(
      <Dialog open>
        <DialogContent fullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveClass("inset-0");
  });

  it("applies inset-0 for mobileFullscreen dialogs", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveClass("inset-0");
  });

  it("does not apply safe-area padding when neither fullscreen nor mobileFullscreen", () => {
    render(
      <Dialog open>
        <DialogContent data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    const style = content.getAttribute("style") || "";
    expect(style).not.toContain("safe-area");
    expect(content).not.toHaveClass("inset-0");
  });

  it("hides close button when fullscreen is true", () => {
    render(
      <Dialog open>
        <DialogContent fullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("shows close button when mobileFullscreen is true", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("hides close button when hideCloseButton is true", () => {
    render(
      <Dialog open>
        <DialogContent hideCloseButton data-testid="dialog-content">
          Content
        </DialogContent>
      </Dialog>
    );
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("accepts mobileSwipeToClose prop without breaking rendering", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent mobileFullscreen mobileSwipeToClose data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Swipe Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toBeInTheDocument();
    expect(content).toHaveClass("inset-0");
  });

  it("applies safe-area padding when mobileSwipeToClose is used with mobileFullscreen", () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen mobileSwipeToClose data-testid="dialog-content">
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const content = screen.getByTestId("dialog-content");
    expect(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
  });

  it('renders hidden close trigger by default on mobile', () => {
    withMobileViewport(() => {
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Swipe Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
      const closeTrigger = document.querySelector('[data-swipe-close-trigger]');
      expect(closeTrigger).toBeInTheDocument();
    });
  });

  it('does not render hidden close trigger when mobileSwipeToClose is false', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent mobileSwipeToClose={false}>
            <DialogHeader>
              <DialogTitle>Swipe Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
      const closeTrigger = document.querySelector('[data-swipe-close-trigger]');
      expect(closeTrigger).not.toBeInTheDocument();
    });
  });

  it('closes dialog when hidden close trigger is activated', () => {
    withMobileViewport(() => {
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Swipe Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
      
      const closeTrigger = document.querySelector('[data-swipe-close-trigger]') as HTMLButtonElement | null;
      expect(closeTrigger).toBeInTheDocument();
      
      if (closeTrigger) {
        closeTrigger.click();
        expect(onOpenChange).toHaveBeenCalledWith(false);
      }
    });
  });

  it('calls onSwipeBack when canSwipeBack is true and swipe completes', () => {
    withMobileViewport(() => {
      const mockOnSwipeBack = vi.fn();
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent
            canSwipeBack={() => true}
            onSwipeBack={mockOnSwipeBack}
            data-testid="swipe-dialog"
          >
            Content
          </DialogContent>
        </Dialog>
      );
      
      const content = screen.getByTestId('swipe-dialog');

      content.dispatchEvent(new TouchEvent('touchstart', {
        touches: [{ clientX: 10, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchmove', {
        touches: [{ clientX: 100, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchend', {
        changedTouches: [{ clientX: 100, clientY: 100 }] as any,
      }));
      
      expect(mockOnSwipeBack).toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  it('attempts close when canSwipeBack is false and swipe completes', () => {
    withMobileViewport(() => {
      const mockOnSwipeBack = vi.fn();
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent
            canSwipeBack={() => false}
            onSwipeBack={mockOnSwipeBack}
            data-testid="swipe-dialog"
          >
            Content
          </DialogContent>
        </Dialog>
      );
      
      const content = screen.getByTestId('swipe-dialog');
      content.dispatchEvent(new TouchEvent('touchstart', {
        touches: [{ clientX: 10, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchmove', {
        touches: [{ clientX: 100, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchend', {
        changedTouches: [{ clientX: 100, clientY: 100 }] as any,
      }));
      
      expect(mockOnSwipeBack).not.toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('applies safe-area style and hidden trigger for mobileFullscreen', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent mobileFullscreen data-testid="dialog-content">
            Content
          </DialogContent>
        </Dialog>
      );
      const content = screen.getByTestId("dialog-content");
      expect(content).toHaveStyle({ paddingTop: "env(safe-area-inset-top, 0px)" });
      expect(document.querySelector('[data-swipe-close-trigger]')).toBeInTheDocument();
    });
  });

  it('does not apply transform styles to non-fullscreen dialogs', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent data-testid="dialog-content">
            Content
          </DialogContent>
        </Dialog>
      );
      const content = screen.getByTestId("dialog-content");
      const style = content.getAttribute("style") || "";
      expect(style).not.toMatch(/transform/);
    });
  });

  it('applies swipe transform to fullscreen dialogs during touchmove', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent fullscreen data-testid="dialog-content">
            Content
          </DialogContent>
        </Dialog>
      );
      const content = screen.getByTestId("dialog-content");
      content.dispatchEvent(new TouchEvent('touchstart', {
        touches: [{ clientX: 10, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchmove', {
        touches: [{ clientX: 50, clientY: 100 }] as any,
      }));
      
      const style = content.getAttribute("style") || "";
      expect(style).toMatch(/transform/);
    });
  });

  it('does not apply swipe transform to non-fullscreen dialogs during touchmove', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent data-testid="dialog-content">
            Content
          </DialogContent>
        </Dialog>
      );
      const content = screen.getByTestId("dialog-content");
      content.dispatchEvent(new TouchEvent('touchstart', {
        touches: [{ clientX: 10, clientY: 100 }] as any,
      }));
      content.dispatchEvent(new TouchEvent('touchmove', {
        touches: [{ clientX: 50, clientY: 100 }] as any,
      }));
      
      const style = content.getAttribute("style") || "";
      expect(style).not.toMatch(/transform/);
    });
  });

  it('binds swipe handler when mobileSwipeToClose and mobileFullscreen are enabled', () => {
    withMobileViewport(() => {
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent mobileFullscreen mobileSwipeToClose data-testid="swipe-dialog">
            <DialogHeader>
              <DialogTitle>Swipe Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      );
      
      const content = screen.getByTestId('swipe-dialog');
      const closeTrigger = document.querySelector('[data-swipe-close-trigger]') as HTMLButtonElement | null;
      
      expect(content).toBeInTheDocument();
      expect(closeTrigger).toBeInTheDocument();
      
      const clickSpy = vi.spyOn(closeTrigger as HTMLButtonElement, 'click');
      closeTrigger?.click();
      
      expect(clickSpy).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});

describe("DialogHeader", () => {
  it("can shrink so a long title truncates instead of widening the dialog", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader data-testid="dialog-header">
            <DialogTitle className="truncate">a very long command that would otherwise widen the dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByTestId("dialog-header")).toHaveClass("min-w-0");
  });
});

function ReturnFocusHost({ onCloseAutoFocus }: { onCloseAutoFocus?: (event: Event) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <textarea aria-label="prompt" />
      <button type="button" onClick={() => setOpen(true)}>open</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>Focus Dialog</DialogTitle>
          <input aria-label="dialog input" autoFocus />
        </DialogContent>
      </Dialog>
    </>
  )
}

function PromptReturnFocusHost() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <textarea data-prompt-input aria-label="chat prompt" />
      <button type="button" onClick={() => setOpen(true)}>open prompt dialog</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Prompt Focus Dialog</DialogTitle>
          <input aria-label="prompt dialog input" autoFocus />
        </DialogContent>
      </Dialog>
    </>
  )
}

async function openAndEscape(returnTarget: HTMLElement) {
  returnTarget.focus()
  fireEvent.click(screen.getByText('open'))
  const input = await screen.findByLabelText('dialog input')
  await waitFor(() => expect(input).toHaveFocus())
  fireEvent.keyDown(input, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByLabelText('dialog input')).not.toBeInTheDocument())
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

describe('Dialog return focus', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('returns focus to the element focused before opening when there is no trigger', async () => {
    stubMatchMedia(true)
    render(<ReturnFocusHost />)
    const prompt = screen.getByLabelText('prompt')

    await openAndEscape(prompt)

    expect(prompt).toHaveFocus()
  })

  it('does not refocus a text field on touch devices, so the keyboard stays closed', async () => {
    stubMatchMedia(false)
    render(<ReturnFocusHost />)
    const prompt = screen.getByLabelText('prompt')

    await openAndEscape(prompt)

    expect(prompt).not.toHaveFocus()
  })

  it('refocuses a non-text element on touch devices', async () => {
    stubMatchMedia(false)
    render(<ReturnFocusHost />)
    const opener = screen.getByText('open')

    await openAndEscape(opener)

    expect(opener).toHaveFocus()
  })

  it('lets a caller onCloseAutoFocus that prevents default take over', async () => {
    stubMatchMedia(true)
    render(<ReturnFocusHost onCloseAutoFocus={(event) => event.preventDefault()} />)
    const prompt = screen.getByLabelText('prompt')

    await openAndEscape(prompt)

    expect(prompt).not.toHaveFocus()
  })

  it('moves focus to the chat prompt when the dialog closes on desktop', async () => {
    stubMatchMedia(true)
    render(<PromptReturnFocusHost />)
    const opener = screen.getByText('open prompt dialog')
    opener.focus()

    fireEvent.click(opener)
    const input = await screen.findByLabelText('prompt dialog input')
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByLabelText('prompt dialog input')).not.toBeInTheDocument())
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))

    expect(screen.getByLabelText('chat prompt')).toHaveFocus()
  })
})

function stubVisualViewport(height: number) {
  const listeners = new Set<() => void>()
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: {
      height,
      offsetTop: 0,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    },
  })
  return listeners
}

describe('keyboardAware', () => {
  const originalInnerHeight = window.innerHeight
  const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')

  afterEach(() => {
    if (originalVisualViewport) {
      Object.defineProperty(window, 'visualViewport', originalVisualViewport)
    } else {
      // @ts-expect-error allow delete
      delete window.visualViewport
    }
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: originalInnerHeight,
    })
  })

  it('applies keyboard inset as bottom padding when keyboardAware and a text input is focused', () => {
    window.innerHeight = 800
    const listeners = stubVisualViewport(500)
    render(
      <Dialog open>
        <DialogContent keyboardAware mobileFullscreen data-testid="dialog-content">
          <textarea autoFocus data-testid="dialog-input" />
        </DialogContent>
      </Dialog>
    );
    screen.getByTestId('dialog-input').focus()
    act(() => {
      listeners.forEach((fn) => fn())
    })
    const content = screen.getByTestId('dialog-content')
    expect(content).toHaveStyle({ paddingBottom: '300px' })
  })

  it('does not set inline bottom padding when no keyboard is present', () => {
    window.innerHeight = 800
    const listeners = stubVisualViewport(800)
    render(
      <Dialog open>
        <DialogContent keyboardAware mobileFullscreen data-testid="dialog-content">
          <textarea autoFocus data-testid="dialog-input" />
        </DialogContent>
      </Dialog>
    );
    screen.getByTestId('dialog-input').focus()
    listeners.forEach((fn) => fn())
    const content = screen.getByTestId('dialog-content')
    expect(content.style.paddingBottom).toBe('')
  })

  it('does not set inline bottom padding when keyboardAware is omitted', () => {
    window.innerHeight = 800
    const listeners = stubVisualViewport(500)
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          <textarea autoFocus data-testid="dialog-input" />
        </DialogContent>
      </Dialog>
    );
    screen.getByTestId('dialog-input').focus()
    listeners.forEach((fn) => fn())
    const content = screen.getByTestId('dialog-content')
    expect(content.style.paddingBottom).toBe('')
  })
});
